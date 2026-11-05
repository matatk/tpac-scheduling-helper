#!/usr/bin/env node
// FIXME: gh option string looks ugly in help output for 'members' command becuase of the trailing \n
// FIXME: Now that we're using Temporal.PlainDateTime for the meeting times, detection of moved meetings should be a lot simpler. Probably good to still keep the day around becuase it helps UX having the day name.
// FIXME: include an option to ignore closed issues? Or do so by default and include one to look at closed issues?
import fs from 'fs'
import path from 'path'

import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'

import TPACs, { tpacYears } from './src/tpacs.ts'
import { calendarInit, calendarMeeting, calendarMeetingsZipped } from './src/calendar.ts'
import { categoriseMeetings, plannedByUs } from './src/meeting.ts'
import { dtf, makeMeetingListPage, makeSchedulingPage, pretty } from './src/html.ts'
import { getMembers, queryIssues } from './src/query-issues.ts'
import meetingFromIssue from './src/meeting-from-issue.ts'
import processSchedule from './src/scheduling.ts'
import { repoFromIssueUrl } from './src/repo.ts'

import type { TpacDayInfo, TpacYear } from './src/tpacs.ts'
import type { CombineNames } from './src/scheduling.ts'
import type { GhIssue } from './src/query-issues.ts'
import type { Meeting } from './src/meeting.ts'

export interface RepoSpec {
	repo: string
	label: string
	personal?: string // FIXME: make always
}

const MY_NAME = 'TPAC Scheduling Helper'
const MY_URL = 'https://github.com/matatk/tpac-scheduling-helper'
const STYLE_FILE = path.join('static', 'style.css')
const SCRIPT_FILE = path.join('static', 'create-issue.js')

type RepoSpecRaw = [string] | [string, string] // [ repo ] | [ repo, label ]
type CombineNamesArgs = [string, string][]

interface BaseArgs {
	alternatives: string[]
	combine: CombineNames
	dayInfo: TpacDayInfo
	issues: GhIssue[]
	title?: string // TODO: avoid the need for this to be here
}

interface GenerateMeetingReportArgs extends BaseArgs {
	year: number
	focus?: string  // FIXME: this needs to be made general
}

interface DoSchedulingArgs extends BaseArgs {
	calDownloaded: Date
}

interface GenerateMeetingListArgs extends DoSchedulingArgs {
	repos: RepoSpec[]
}

function errorOut(...args: unknown[]) {
	console.error(...args)
	process.exit(42)
}

function write(fileName: string, thingName: string, text: string) {
	fs.writeFileSync(fileName, text)
	console.log('Written', thingName, 'to:', fileName)
}

function pathFromPackageRoot(partial: string) {
	let dir = import.meta.dirname
	while (dir !== path.parse(dir).root) {
		if (fs.existsSync(path.join(dir, 'package.json'))) {
			return path.join(dir, partial)
		}
		dir = path.dirname(dir)
	}
	throw new Error("Couldn't find static assets.")
}

function getIssues(gh: string, repos: RepoSpec[], queryResult?: string, includeComments?: boolean) {
	const issues: GhIssue[] = []

	if (queryResult) {
		console.log('Using existing query result:', queryResult)
		issues.push(...JSON.parse(fs.readFileSync(queryResult, 'utf-8')) as unknown as GhIssue[])
	} else {
		console.log('Querying repo(s) with gh...')
		for (const { repo, label } of repos) {
			try {
				issues.push(...queryIssues(gh, repo, label, includeComments))
			} catch (err) {
				errorOut(err)
			}
		}
	}

	if (issues.length === 0) console.error('No issues found')
	return issues
}

function makeEquivalents(combine?: CombineNamesArgs): CombineNames {
	const equivalents: CombineNames = new Map()
	if (combine) {
		for (const [ name, otherName ] of combine) {
			equivalents.set(name, otherName)
		}
	}
	return equivalents
}

function generateMeetingList({
	alternatives,
	calDownloaded,
	combine,
	dayInfo,
	issues,
	repos,
	title,
}: GenerateMeetingListArgs): string {
	// NOTE: This includes invalid ones
	const plannedMeetings = issues.reduce(
		(acc: Record<string, Partial<Meeting>[]>, issue) => {
			const meeting = meetingFromIssue(dayInfo, calendarMeeting, combine, issue)
			if (meeting.id && plannedByUs(alternatives, meeting)) {
				if (acc[meeting.id]) {
					acc[meeting.id]!.push(meeting)
				} else {
					acc[meeting.id] = [ meeting ]
				}
			}
			return acc
		}, {})

	const { allMeetings, meetingsWithBookings } = calendarMeetingsZipped(plannedMeetings)

	// TODO: could move this further up and then wouldn't have to pass stuff around as much (like title)
	const html = makeMeetingListPage({
		allMeetings,
		calDownloaded,
		meetingsWithBookings,
		dayInfo,
		toolName: MY_NAME,
		toolUrl: MY_URL,
		repos,
		script: pathFromPackageRoot(SCRIPT_FILE),
		style: pathFromPackageRoot(STYLE_FILE),
		title,
	})

	return html
}

function doScheduling({
	alternatives,
	calDownloaded,
	combine,
	dayInfo,
	issues,
	title,
}: DoSchedulingArgs): string {
	// FIXME: DRY: Can we do this one level up to avoid duplicating work in the case that we are generating both pages?
	const allMeetings = issues.map((issue => meetingFromIssue(dayInfo, calendarMeeting, combine, issue)))

	// NOTE: These are returned having been filtered for relevance to the given alternative attendees, except for unassigned meetings, as we can't know in that case :-).
	const {
		validMeetings,
		// All of the rest are only used in the output stage
		cancelledMeetings,
		movedMeetings,
		invalidMeetings,
		unassignedMeetings,
	} = categoriseMeetings(allMeetings, alternatives)

	const {
		repoPossibleDuplicates,
		peopleNearlyClashingMeetings,
		peopleDefinitelyClashingMeetings,
		personDayMeetings,
		dayMeetings,
		haveDefinitelyClashing,
		haveNearlyClashing,
		personDayGaps,
	} = processSchedule(dayInfo, alternatives, validMeetings)

	const html = makeSchedulingPage({
		calDownloaded,
		invalidMeetings,
		validMeetings,
		movedMeetings,
		repoPossibleDuplicates,
		unassignedMeetings,
		cancelledMeetings,
		peopleNearlyClashingMeetings,
		peopleDefinitelyClashingMeetings,
		personDayMeetings,
		dayMeetings,
		haveDefinitelyClashing,
		haveNearlyClashing,
		personDayGaps,
		style: pathFromPackageRoot(STYLE_FILE),
		toolName: MY_NAME,
		toolUrl: MY_URL,
		title,
	})

	return html
}

function generateMeetingReport({
	alternatives,
	combine,
	dayInfo,
	focus,
	issues,
	title,
	year,
}: GenerateMeetingReportArgs): string {
	// FIXME: DRY: Can we do this one level up to avoid duplicating work in the case that we are generating both pages?
	const allMeetings = issues.map((issue => meetingFromIssue(dayInfo, calendarMeeting, combine, issue)))

	// NOTE: These are returned having been filtered for relevance to the given alternative attendees, except for unassigned meetings, as we can't know in that case :-).
	const {
		validMeetings,
		// All of the rest are only used in the output stage
	} = categoriseMeetings(allMeetings, alternatives)

	// TODO: Use html/makeTitle instead?
	const realTitle = (title ? `${title} - ` : '') + `TPAC ${String(year)} Report`
	let out = `---\ntitle: ${realTitle}\n---\n\n`
	let unassignedMeetingInfo = ''
	let unassignedCount = 0
	let unfocusedMeetingInfo = ''
	let unfocusedCount = 0

	for (const meeting of validMeetings) {
		const ourPeopleAttending = meeting.names.filter(name => alternatives.includes(name))

		if (ourPeopleAttending.length === 0 && !meeting.report) {
			unassignedCount += 1
			unassignedMeetingInfo += '| ' +
				'U-' + String(unassignedCount) + ' | ' +
				repoFromIssueUrl(meeting.issueUrl) + '|' +
				meeting.title + ' | ' +
				'<' + meeting.issueUrl + '> |\n'
			continue
		}

		if (focus && repoFromIssueUrl(meeting.issueUrl) !== focus) {
			unfocusedCount += 1
			unfocusedMeetingInfo += '| ' +
				'O-' + String(unfocusedCount) + ' | ' +
				repoFromIssueUrl(meeting.issueUrl) + '|' +
				meeting.title + ' | ' +
				'<' + meeting.issueUrl + '> |\n'
			continue
		}

		const heading = meeting.calendarTitle +
			(meeting.title === meeting.calendarTitle ? '' : ` [${meeting.title}]`)

		const ourPeopleList = ourPeopleAttending.map(name => `* ${name}`)

		const dayTime =
			pretty(meeting.calendarDay) + ', ' +
			dtf(meeting.calendarStart) + ' - ' + dtf(meeting.calendarEnd)

		out += `# ${heading}\n\n`

		out += 'Metadata:\n\n'
		out += `* [${dayTime} (W3C Calendar entry)](${meeting.calendarUrl})\n`
		out += `* [Scheduling issue #${meeting.issueUrl.split('/').at(-1)} in ${repoFromIssueUrl(meeting.issueUrl)}](${meeting.issueUrl})\n`
		out += (meeting.reportMetadata ?? '') + '\n\n'

		out += 'Attending from our group:\n\n'
		out += (ourPeopleList.length ? ourPeopleList.join('\n') : '* (none of us)') + '\n\n'

		out += (meeting.report ?? '(no report)') + '\n\n'
	}

	if (unassignedMeetingInfo.length > 0) {
		unassignedMeetingInfo =
			'# Info on unassigned meetings\n\n'.toUpperCase() +
			'This section can be deleted once you have satisfied yourself that all important unassigned meetings have been brought into this repo, if needed, and adequately reported on.\n\n' +
			'| ID | Repo | Meeting title | Booking issue URL |\n' +
			'|----|------|---------------|-------------------|\n' +
			unassignedMeetingInfo
	}

	if (unfocusedMeetingInfo.length > 0) {
		unfocusedMeetingInfo =
			'# Info on meetings from other repos\n\n'.toUpperCase() +
			'This section can be deleted once you have satisfied yourself that all important meetings from other repos have been brought into this repo, and adequately reported on.\n\n' +
			'| ID | Repo | Meeting title | Booking issue URL |\n' +
			'|----|------|---------------|-------------------|\n' +
			unfocusedMeetingInfo
	}

	return unassignedMeetingInfo + unfocusedMeetingInfo + out
}

function main() {
	return yargs(hideBin(process.argv)).parserConfiguration({
		'flatten-duplicate-arrays': false,
	})
		.option('gh', {
			type: 'string',
			description: 'Path to/name of gh binary.\n',
			default: 'gh',
		})
		.command('$0', 'Carry out scheduling and/or generate the planning page',
			yargs => yargs
				.options({
					calendar: {
						alias: 'c',
						type: 'string',
						description: "Path to the local meetings schedule ICS file. It will be downloaded from w3.org (according to the --year option's value) if it doesn't exist.\n",
					},
					'output-plan': {
						alias: 'p',
						type: 'string',
						description: 'Path to a local HTML file to create (or overwrite) with info on all TPAC meetings, so you can decide which to attend.\n',
					},
					'output-schedule': {
						alias: 's',
						type: 'string',
						description: 'Path to a local HTML file to create (or overwrite) with info on your planned meetings, and possible clashes.\n',
					},
					'output-report': {
						alias: 'R',
						type: 'string',
						description: 'Path to a local Markdown file to create (or overwrite) with your event report.\n',
					},
					year: {
						alias: 'y',
						choices: tpacYears,
						description: 'Which TPAC year to use (defaults to the latest year).\n',
						default: tpacYears.at(-1),
					},
					repo: {
						alias: 'r',
						type: 'string',
						array: true,
						description: 'GitHub repo(s) containing TPAC meeting-planning issues. By default, the same label will be applied to all repo searches. If you want to use different labels for some repos, you can specify the label to use after the repo shortname/URL.\n\n(Not required if you are using the --query-results debugging option.)\n',
					},
					label: {
						alias: 'l',
						type: 'string',
						description: 'GitHub issue label to indicate TPAC meeting-planning issues. Can be overridden per repo, via the --repo option',
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
					alternatives: {
						alias: 'a',
						type: 'string',
						array: true,
						description: 'People (rather, their GitHub login names) who you want to consider as possible alternatives to attend meetings in the event of clashes. By default, all people referenced by the found issues will be considered as possible alternative meeting attendees.\n\nYou might want to use this if you run the tool from the perspective of different groups, e.g. a WG, or those of your colleagues who are attending TPAC.\n',
						default: [],
					},
					combine: {
						alias: 'C',
						type: 'string',
						array: true,
						description: 'Pairs of GitHub usernames to consider equivalent. Useful for if you are querying across public and enterprise GitHub instances. The first name in the pair will be overridden by the second.\n',
					},
					title: {
						alias: 't',
						type: 'string',
						description: "Include this in the HTML output (useful to distinguish between groups' schedules)\n",
					},
				})
				.coerce('repo', repo => {
					if (Array.isArray(repo)
							&& repo.length <= 2  // NOTE: Won't work if user puts two repos after one switch.
							&& repo.every(value => typeof value === 'string')) {
						return [ repo ]
					}
					return repo as []
				})
				.coerce('alternatives', alternatives => Array.isArray(alternatives) ? alternatives : [])
				.coerce('combine', combine => {
					if (Array.isArray(combine)
							&& combine.length === 2
							&& combine.every(value => typeof value === 'string')) {
						return [ combine ]
					}
					return combine as CombineNamesArgs
				})
				.conflicts('repo', 'query-result')
				.check(args => {
					const outputs = [ 'output-plan', 'output-schedule', 'output-report' ]
					const count = outputs.reduce((acc, cur) => {
						return args[cur] !== undefined ? acc + 1 : acc
					}, 0)
					if (count < 1) throw new Error(`At least one of the output options (${outputs.join(', ')}) must be specified.`)
					return true
				})
				.check(args => {
					if (!args.repo) return true
					if (!args.repo.every(value =>
						Array.isArray(value) && (value.length === 1 || value.length === 2))) {
						errorOut('Every \'repo\' option value must be either a GitHub repo, OR a GitHub repo and issue label to use when querying that repo. The values specified were:', args.repo)
					}
					return true
				})
				.check(args => {
					if (!args.combine) return true
					if (!args.combine.every(value => Array.isArray(value) && value.length === 2)) {
						errorOut('Every \'equivalent\' option value must be a pair of two usernames to consider equal. The values specified were:', args.combine)
					}
					return true
				})
				.conflicts('query-result', 'save-result')
				.example('--repo w3c/apa-tpac-meetings', 'Query the "w3c/apa-tpac-meetings" repo, fetching all issues, or those labelled as per the --label option.\n')
				.example('--repo w3c/apa --repo w3c/aria', 'Query multiple repos.\n')
				.example('--repo w3c/apa tpac-2025 --repo w3c/aria', 'Use a specific label for the "w3c/apa" repo.\n')
				.example('--combine TopSecretAnna PublicAnna', 'Any instance of TopSecretAnna will be considered as PublicAnna.\n')
				.group([ 'calendar', 'repo', 'output-plan', 'output-schedule' ], 'Vital info:')
				.group([ 'label', 'gh', 'alternatives', 'combine' ], 'Issue/filtering options:')
				.group([ 'title' ], 'Output niceties:')
				.group([ 'save-result', 'query-result', 'year' ], 'Testing and debugging options:')
				.group([ 'help', 'version' ], 'Workhorses:'),
			argv => {
				type ProgArgs = Omit<typeof argv,
					| 'alternatives'
					| 'combine'
					| 'outputPlan'
					| 'outputSchedule'
					| 'outputReport'
					| 'repo'
					| 'year'
				> & {
					alternatives: string[]
					combine?: CombineNamesArgs
					outputPlan: string
					outputSchedule: string
					outputReport: string
					repo?: RepoSpecRaw[]
					year: TpacYear
				}

				const repos = (argv as ProgArgs).repo?.reduce((acc: RepoSpec[], cur) => {
					if (cur.length == 2) {
						acc.push({ repo: cur[0], label: cur[1] })
					} else {
						acc.push({ repo: cur[0], label: argv.label ?? '' })
					}
					return acc
				}, []) ?? []

				const tpac = TPACs[(argv as ProgArgs).year]
				const calDownloaded = calendarInit(tpac.icsUrl, argv.calendar)
				const issues = getIssues(argv.gh, repos, argv.queryResult, !!argv.outputReport)

				const combine = makeEquivalents(argv.combine)

				if (argv.outputPlan) {
					write((argv as ProgArgs).outputPlan, 'meeting list', generateMeetingList({
						alternatives: (argv as ProgArgs).alternatives,
						calDownloaded,
						combine,
						dayInfo: tpac.days,
						issues,
						repos,
						title: argv.title,
					}))
				}

				if (argv.outputSchedule) {
					write((argv as ProgArgs).outputSchedule, 'scheduling info', doScheduling({
						alternatives: (argv as ProgArgs).alternatives,
						calDownloaded,
						combine,
						dayInfo: tpac.days,
						issues,
						title: argv.title,
					}))
				}

				if (argv.outputReport) {
					write((argv as ProgArgs).outputReport, 'report', generateMeetingReport({
						alternatives: (argv as ProgArgs).alternatives,
						combine,
						dayInfo: tpac.days,
						focus: repos[0]?.repo,
						issues,
						title: argv.title,
						year: (argv as ProgArgs).year,
					}))
				}

				if (argv.saveResult) {
					write(argv.saveResult, 'JSON returned via gh', JSON.stringify(issues, null, 2))
				}
			})
		.command(
			'members',
			'Try to find group members via their GitHub Team access to a given repo',
			yargs => yargs
				.options({
					org: {
						alias: 'o',
						type: 'string',
						description: 'GitHub organisation. E.g. w3c',
						demandOption: true,
					},
					repo: {
						alias: 'r',
						type: 'string',
						description: 'GitHub repo name. E.g. apa-tpac-meetings',
						demandOption: true,
					},
					all: {
						alias: 'a',
						type: 'boolean',
						description: 'Fetch all members of all teams associated with the repository (try this only if the script cannot find an obvious single members team).',
						default: false,
					},
				}),
			argv => {
				getMembers(argv.gh, argv.org, argv.repo, argv.all)
			})
		.strict()
		.parseSync()
}

main()
