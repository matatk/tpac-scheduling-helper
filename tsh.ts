#!/usr/bin/env node
// FIXME: Now that we're using Temporal.PlainDateTime for the meeting times, detection of moved meetings should be a lot simpler. Probably good to still keep the day around becuase it helps UX having the day name.
import fs from 'fs'
import path from 'path'

import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'

import TPACs, { TpacYears } from './src/tpacs.ts'
import { calendarInit, calendarMeeting, calendarMeetingsZipped } from './src/calendar.ts'
import { makeMeetingListPage, makeSchedulingPage } from './src/html.ts'
import { categoriseMeetings } from './src/meeting.ts'
import meetingFromIssue from './src/meeting-from-issue.ts'
import processSchedule from './src/scheduling.ts'
import queryIssues from './src/query-issues.ts'

import type { ArgumentsCamelCase, Argv, InferredOptionTypes } from 'yargs'

import type { CombinedNames } from './src/scheduling.ts'
import type { GhIssue } from './src/query-issues.ts'
import type { Meeting } from './src/meeting.ts'
import type { TpacYear } from './src/tpacs.ts'

const MY_NAME = 'TPAC scheduling helper'
const MY_URL = 'https://github.com/matatk/tpac-scheduling-helper'
const STYLE_FILE = path.join(import.meta.dirname, 'static', 'style.css')
const SCRIPT_FILE = path.join(import.meta.dirname, 'static', 'create-issue.js')

const globalOptions = {
	// FIXME: rename to calendar, and rename combine to merge/equiv.?
	meetings: {
		alias: 'm',
		type: 'string',
		description: 'Path to the local meetings schedule ICS file. It will be downloaded from the TPAC site if it doesn\'t exist.\n',
		required: true,
	},
	output: {
		alias: 'o',
		type: 'string',
		description: 'Path to a local HTML file to create (or overwrite) with info on your planned meetings, and possible clashes.\n',
		required: true,
	},
	year: {
		alias: 'y',
		choices: TpacYears,
		description: 'Which TPAC year to use (defaults to the latest year).\n',
		default: TpacYears.at(-1),
	},
	repo: {
		alias: 'r',
		type: 'string',
		array: true,
		description: 'GitHub repo(s) containing TPAC meeting-planning issues. By default, the same label will be applied to all repo searches. If you want to use different labels for some repos, you can specify the label to use after the repo shortname/URL.\n\n(Not required if you are using the --query-results debugging\n',
	},
	label: {
		alias: 'l',
		type: 'string',
		description: 'GitHub issue label to indicate TPAC meeting-planning issues. Can be overridden per repo, via the --repon',
		default: 'tpac',
	},
	'query-result': {
		alias: 'q',
		type: 'string',
		description: 'Path to local JSON file that contains issues returned in GitHub API query responses. Overrides --repo.\n',
	},
	'save-result': {
		alias: 'S',
		type: 'string',
		description: 'Path to local JSON file to save all issues returned from all GitHub API query responses.\n',
	},
	gh: {
		type: 'string',
		description: 'Path to/name of gh binary.\n',
		default: 'gh',
	},
} as const

const schedulingOptions = {
	alternatives: {
		alias: 'a',
		type: 'string',
		array: true,
		description: 'People (rather, their GitHub login names) who you want to consider as possible alternatives to attend meetings in the event of clashes. By default, all people referenced by the found issues will be considered as possible alternative meeting attendees.\n\nYou might want to use this if you run the tool from the perspective of different groups, e.g. a WG, or those of your colleagues who are attending TPAC.\n',
	},
	combine: {
		alias: 'c',
		type: 'string',
		array: true,
		description: 'Pairs of GitHub usernames to consider equivalent. Useful for if you are querying across public and enterprise GitHub instances. The first name in the pair will be overridden by the second.\n',
	},
} as const

type RepoSpec = [string] | [string, string]

type GlobalArgs = Omit<InferredOptionTypes<typeof globalOptions>, 'year' | 'repo'> & {
	year: TpacYear // TODO: Is there a neater way to do this? Making the switch required works, but makes the help text misleading.
	repo?: RepoSpec[]
}

type SchedulingArgs = Omit<InferredOptionTypes<typeof schedulingOptions>, 'combine'> & {
	combine?: [string, string][]
} & GlobalArgs

function errorOut(...args: unknown[]) {
	console.error(...args)
	process.exit(42)
}

function main() {
	return yargs(hideBin(process.argv)).parserConfiguration({
		'flatten-duplicate-arrays': false,
	})
		.options(globalOptions)
		.coerce('repo', repo => {
			if (Array.isArray(repo)
				&& repo.length <= 2  // NOTE: Won't work if user puts two repos after one switch.
				&& repo.every(value => typeof value === 'string')) {
				return [ repo ]
			}
			return repo as RepoSpec[]
		})
		.check(args => {
			if (!args.repo) return true
			if (!args.repo.every(value =>
				Array.isArray(value) && (value.length === 1 || value.length === 2))) {
				errorOut('Every \'repo\' option value must be either a GitHub repo, OR a GitHub repo and issue label to use when querying that repo. The values specified were:', args.repo)
			}
			return true
		})
		.conflicts('query-result', 'save-result')
		.command('gen', 'Create list of all meetings', yargs => {
			addExamplesAndGroups(yargs, false)
		}, args => {
			generateMeetingList(args as unknown as ArgumentsCamelCase<GlobalArgs>)
		})
		.command('schedule', 'Create timetables, and highlight clashes, for your team', yargs => {
			return addExamplesAndGroups(yargs, true)
				.options(schedulingOptions)
				.coerce('alternatives', Array.prototype.flat)
				.coerce('combine', combine => {
					if (Array.isArray(combine)
						&& combine.length === 2
						&& combine.every(value => typeof value === 'string')) {
						return [ combine ]
					}
					return combine as [string, string][]
				})
				.check(args => {
					if (args['repo'] === undefined && args['query-result'] === undefined) {
						throw new Error('One of \'--repo\' and \'--query-result\' must be supplied.')
					}
					return true
				})
				.check(args => {
					args.alternatives ??= []
					return true
				})
				.check(args => {
					if (!args.combine) return true
					if (!args.combine.every(value => Array.isArray(value) && value.length === 2)) {
						errorOut('Every \'equivalent\' option value must be a pair of two usernames to consider equal. The values specified were:', args.combine)
					}
					return true
				})
		}, args => {
			doScheduling(args as unknown as ArgumentsCamelCase<SchedulingArgs>)
		})
		.strict()
		.parseSync()
}

function addExamplesAndGroups(yargs: Argv, includeExtras: boolean): Argv {
	const extra = includeExtras ? [ 'alternatives', 'combine' ] : []

	const yargsWithGroupsAndExamples = yargs
		.example('--repo w3c/apa-tpac-meetings', 'Query the "w3c/apa-tpac-meetings" repo, use the default label, or that specified with the --label option.\n')
		.example('--repo w3c/apa --repo w3c/aria', 'Query multiple repos.\n')
		.example('--repo w3c/apa tpac-2025 --repo w3c/aria', 'Use a custom label for the "w3c/apa" repo.\n')
		.group([ 'meetings', 'output', 'repo' ], 'Vital info:')
		.group([ 'label', 'gh', ...extra ], 'Issue/filtering options:')
		.group([ 'save-result', 'query-result', 'year' ], 'Testing and debugging options:')
		.group([ 'help', 'version' ], 'Workhorses:')

	const yargsWithEvenMore = includeExtras
		? yargsWithGroupsAndExamples.example('--combine TopSecretAnna PublicAnna', 'Any instance of TopSecretAnna will be considered as PublicAnna.\n')
		: yargsWithGroupsAndExamples

	return yargsWithEvenMore
}

function getIssues(gh: string, defaultLabel: string, repo?: RepoSpec[], queryResult?: string) {
	const issues: GhIssue[] = []

	if (queryResult) {
		console.log('Using existing query result.')
		issues.push(...JSON.parse(fs.readFileSync(queryResult, 'utf-8')) as unknown as GhIssue[])
	} else if (repo) {
		console.log('Querying repo(s)...')
		for (const repoLabel of repo) {
			try {
				issues.push(...queryIssues(gh, repoLabel[0], repoLabel[1] ?? defaultLabel))
			} catch (err) {
				errorOut(err)
			}
		}
	}

	if (issues.length === 0) console.error('No issues found')
	return issues
}

function doScheduling(args: ArgumentsCamelCase<SchedulingArgs>) {
	const tpac = TPACs[args.year]
	const equivalents: CombinedNames = new Map()
	calendarInit(tpac.icsUrl, args.meetings)

	if (args.combine) {
		for (const [ name, otherName ] of args.combine) {
			equivalents.set(name, otherName)
		}
	}

	// FIXME: DRY with gen?
	const issues = getIssues(args.gh, args.label, args.repo, args.queryResult)
	const allMeetings = issues.map((issue => meetingFromIssue(tpac.days, calendarMeeting, issue)))

	const {
		validMeetings,
		// All of the rest are only used in the output stage
		cancelledMeetings,
		movedMeetings,
		invalidMeetings,
		unassignedMeetings,
	} = categoriseMeetings(allMeetings)

	const {
		repoPossibleDuplicates,
		peopleNearlyClashingMeetings,
		peopleDefinitelyClashingMeetings,
		personDayMeetings,
		dayMeetings,
		haveDefinitelyClashing,
		haveNearlyClashing,
		personDayGaps,
	} = processSchedule(tpac.days, equivalents, args.alternatives ?? [], validMeetings)

	const html = makeSchedulingPage({
		invalidMeetings,
		validMeetings,
		movedMeetings,
		repoPossibleDuplicates,
		unassignedMeetings,
		cancelledMeetings,
		peopleNearlyClashingMeetings,
		peopleDefinitelyClashingMeetings,
		personDayMeetings,
		equivalents,
		dayMeetings,
		haveDefinitelyClashing,
		haveNearlyClashing,
		personDayGaps,
		style: STYLE_FILE,
		myName: MY_NAME,
		myUrl: MY_URL,
	})

	fs.writeFileSync(args.output, html)
	console.log('Written', args.output + '.')
	if (args.saveResult) {
		fs.writeFileSync(args.saveResult, JSON.stringify(issues, null, 2))
		console.log('Written', args.saveResult + '.')
	}
}

function generateMeetingList(args: ArgumentsCamelCase<GlobalArgs>) {
	const tpac = TPACs[args.year]
	calendarInit(tpac.icsUrl, args.meetings)

	// NOTE: This includes invalid ones
	const plannedMeetings = getIssues(args.gh, args.label, args.repo, args.queryResult).reduce(
		(acc: Record<string, Partial<Meeting>[]>, issue) => {
			const meeting = meetingFromIssue(tpac.days, calendarMeeting, issue)
			if (meeting.id) {
				if (acc[meeting.id]) {
					acc[meeting.id]!.push(meeting)
				} else {
					acc[meeting.id] = [ meeting ]
				}
			}
			return acc
		}, {})

	const allMeetings = calendarMeetingsZipped(plannedMeetings)
	console.log(allMeetings.length, 'events (including calendar events, and planned meeting attendances)')

	const html = makeMeetingListPage({
		allMeetings,
		myName: MY_NAME,
		myUrl: MY_URL,
		repos: args.repo?.map(repoLabel => repoLabel[0]).reverse() ?? [],
		script: SCRIPT_FILE,
		style: STYLE_FILE,
	})
	fs.writeFileSync(args.output, html)
	console.log('Written', args.output + '.')
}

main()
