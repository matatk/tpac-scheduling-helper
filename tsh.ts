#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'

import TPACs from './src/tpacs.ts'
import { TpacYears } from './src/tpacs.ts'
import { categoriseMeetings } from './src/meeting.ts'
import getIssues from './src/get-issues.ts'
import { makeHtml } from './src/html.ts'
import meetingFromIssue from './src/meeting-from-issue.ts'
import processSchedule from './src/scheduling.ts'

import type { ArgumentsCamelCase, InferredOptionTypes } from 'yargs'

import type { CombinedNames } from './src/scheduling.ts'
import type { GhIssue } from './src/get-issues.ts'

const MY_NAME = 'TPAC scheduling helper'
const MY_URL = 'https://github.com/matatk/tpac-scheduling-helper'
const STYLE_FILE = path.join(import.meta.dirname, 'style.css')

const globalOptions = {
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
	label: {
		alias: 'l',
		type: 'string',
		description: 'GitHub issue label to indicate TPAC meeting-planning issues. Can be overridden per repo, via the --repon',
		default: 'tpac',
	},
	repo: {
		alias: 'r',
		type: 'string',
		array: true,
		description: 'GitHub repo(s) containing TPAC meeting-planning issues. By default, the same label will be applied to all repo searches. If you want to use different labels for some repos, you can specify the label to use after the repo shortname/URL.\n\n(Not required if you are using the --query-results debugging\n',
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

type GlobalOptionsType = typeof globalOptions
type GlobalArgs = InferredOptionTypes<GlobalOptionsType>

type SchedulingOptionsType = typeof schedulingOptions & typeof globalOptions
type SchedulingArgs = InferredOptionTypes<SchedulingOptionsType>

function errorOut(...args: unknown[]) {
	console.error(...args)
	process.exit(42)
}

function main() {
	return yargs(hideBin(process.argv)).parserConfiguration({
		'flatten-duplicate-arrays': false,
	})
		.usage(MY_NAME + '\n\nUsage: $0 [options]')
		.options(globalOptions)
		.command('gen', 'FIXME', () => {}, generateMeetingList)
		.command('schedule', 'FIXME', yargs => {
			return yargs
				.options(schedulingOptions)
				.coerce('alternatives', alts => {
					const flat: string[] = []
					for (const alt of alts) {
						if (typeof alt === 'string') {
							flat.push(alt)
						} else {
							flat.push(...alt as string[])
						}
					}
					return flat
				})
				.example('--repo w3c/apa-tpac-meetings', 'Query the "w3c/apa-tpac-meetings" repo, use the default label, or that specified with the --label option.\n')
				.example('--repo w3c/apa --repo w3c/aria', 'Query multiple repos.\n')
				.example('--repo w3c/apa tpac-2025 --repo w3c/aria', 'Use a custom label for the "w3c/apa" repo.\n')
				.example('--combine TopSecretAnna PublicAnna', 'Any instance of TopSecretAnna will be considered as PublicAnna.\n')
				.check(args => {
					args.alternatives ??= []
					return true
				})
				.check(args => {
					if (!args.repo && !args['query-result']) {
						throw new Error('One of \'--repo\' and \'--query-result\' must be supplied.')
					}
					return true
				})
				.group([ 'meetings', 'output', 'repo' ], 'Vital info:')
				.group([ 'alternatives', 'combine', 'label', 'gh' ], 'Issue/filtering options:')
				.group([ 'save-result', 'query-result', 'year' ], 'Testing and debugging options:')
				.group([ 'help', 'version' ], 'Workhorses:')
				.conflicts('query-result', 'save-result')
		}, args => {
			doScheduling(args)
		})
		.strict()
		.parseSync()
}

function doScheduling(args: ArgumentsCamelCase<SchedulingArgs>) {
	const equivalents: CombinedNames = new Map()
	const issues: GhIssue[] = []
	const tpac = TPACs[args.year]
	const getCalendarInfo = tpac.makeGetter(args.meetings)

	// FIXME: Figure out TypeScript/yargs workaround, and DRY with the below
	if (args.combine) {
		if (args.combine.length === 2 && args.combine.every(value => typeof value === 'string')) {
			args.combine = [ args.combine ] as unknown as string[]
		}
		if (!args.combine.every(value =>
			Array.isArray(value) && value.length === 2)) {
			errorOut('Every \'equivalent\' option value must be a pair of two usernames to consider equal. The values specified were:', args.combine)
		}
		for (const [ name, otherName ] of args.combine) {
			equivalents.set(name!, otherName!)
		}
	}

	if (args.queryResult) {
		console.log('Using existing query result.')
		issues.push(...JSON.parse(fs.readFileSync(args.queryResult, 'utf-8')) as unknown as GhIssue[])
	} else if (args.repo) {
		console.log('Querying repo(s)...')

		if (args.repo.length <= 2 && args.repo.every(value => typeof value === 'string')) {
			args.repo = [ args.repo ] as unknown as string[]
		}
		if (!args.repo.every(value =>
			Array.isArray(value) && value.length > 0 && value.length < 3)) {
			errorOut('Every \'repo\' option value must be either a GitHub repo, OR a GitHub repo and issue label to use when querying that repo. The values specified were:', args.repo)
		}
		// NOTE: TypeScript doesn't seem to know it, but at this point we know that args.repo is an array of 1- or 2-value arrays.
		for (const repoLabel of args.repo) {
			try {
				issues.push(...getIssues(args.gh, repoLabel[0]!, repoLabel[1] ?? args.label))
			} catch (err) {
				errorOut(err)
			}
		}
	}

	if (issues.length === 0) {
		console.error('No issues found')
		return
	}

	const allMeetings = issues.map((issue =>
		meetingFromIssue(tpac.days, getCalendarInfo, issue)))

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
	} = processSchedule(tpac.days, equivalents, args.alternatives!, validMeetings)

	const html = makeHtml({
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
	const tpac = TPACs[args.year!]
	const getCalendarInfo = tpac.makeGetter(args.meetings)

	fs.writeFileSync(args.output, html)
	console.log('Written', args.output + '.')
}

main()
