#!/usr/bin/env node
import fs from 'fs'
import { spawnSync } from 'child_process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Temporal } from '@js-temporal/polyfill'
import TPACs from './src/tpacs.ts'

import meetingFromIssue from './src/meeting-from-issue.ts'
import ClashingMeetingsSet from './src/clashing-meetings-set.ts'
import { makeCalendarMeetingInfoGetter } from './src/calendar-meeting-info.ts'
import { Days } from './src/day.ts'
import { makeHtml } from './src/html.ts'
import { Clash, categoriseMeetings, clashes, isMeetingInGap, sameActualMeeting } from './src/meeting.ts'
import { TpacYears } from './src/tpacs.ts'

import type { Day } from './src/day.ts'
import type { Gap, Meeting } from './src/meeting.ts'

export type CombinedNames = Map<string, string>
type DayThings<T> = Map<Day, T[]>
export type DayMeetings = DayThings<Meeting>
type DayGaps = DayThings<Gap>
export type PersonDayMeetings = Map<string, DayMeetings>
export type PersonClashingMeetings = Map<string, ClashingMeetingsSet>
export type PersonDayGaps = Map<string, DayGaps>
type RepoMeetings = Map<string, Meeting[]>
export type RepoDuplicateMeetings = Map<string, Meeting[][]>

export interface GhIssue {
	assignees: GhAssignee[]
	body: string
	title: string
	url: string
}

interface GhAssignee {
	id: string
	login: string
	name: string
	databaseId: number
}

const MY_NAME = 'TPAC scheduling helper'

function dayThings<T extends Meeting | Gap>(): Map<Day, T[]> {
	return new Map(Days.map(day => [ day, [] ]))
}

function errorOut(...args: any) {
	console.error(...args)
	process.exit(42)
}

export function repo(issueUrl: string): string {
	return issueUrl.slice(19).split('/').slice(0, -2).join('/')
}

function addMeeting<T extends Day | string>(map: Map<T, Meeting[]>, key: T, meeting: Meeting) {
	if (map.has(key)) {
		map.get(key)!.push(meeting)
	} else {
		map.set(key, [ meeting ])
	}
}

function addClashingMeeting(map: Map<string, ClashingMeetingsSet>, name: string, m: Meeting, o: Meeting) {
	if (!map.has(name)) {
		map.set(name, new ClashingMeetingsSet())
	}
	map.get(name)!.add(m, o)
}

function getIssues(repo: string, label: string): GhIssue[] {
	const cmd = 'gh'
	const args = [ '--repo', repo, 'issue', 'list', '--label', label, '--json', 'assignees,body,title,url', '--limit', '999' ]
	console.log(cmd, args.join(' '))
	const child = spawnSync(cmd, args)
	if (child.error || child.status !== 0) {
		errorOut('Error reported by gh:', child.stderr.toString())
	}
	try {
		return JSON.parse(child.stdout.toString())
	} catch (err) {
		errorOut('Error parsing GitHub API result:', err instanceof Error ? err.message : err)
	}
	return []  // NOTE: Here for TypeScript
}

function alternatives(
	possibleAlternatives: string[],
	personDayGaps: PersonDayGaps,
	meeting: Meeting,
): string[] {
	const out: string[] = []

	for (const person of personDayGaps.keys()) {
		if (meeting.names.includes(person)) continue
		if (possibleAlternatives.length > 0 && !possibleAlternatives.includes(person)) continue
		for (const gap of personDayGaps.get(person)?.get(meeting.day) ?? []) {
			if (isMeetingInGap(meeting, gap)) {
				out.push(person)
			}
		}
	}

	return out
}

function getArgs() {
	return yargs(hideBin(process.argv)).parserConfiguration({
		'flatten-duplicate-arrays': false,
	})
		.usage(MY_NAME + '\n\nUsage: $0 [options]')
		.option('alternatives', {
			alias: 'a',
			type: 'string',
			array: true,
			description: 'People (rather, their GitHub login names) who you want to consider as possible alternatives to attend meetings in the event of clashes. By default, all people referenced by the found issues will be considered as possible alternative meeting attendees.\n\nYou might want to use this if you run the tool from the perspective of different groups, e.g. a WG, or those of your colleagues who are attending TPAC.\n',
			coerce: alts => {
				const flat = []
				for (const alt of alts) {
					if (typeof alt === 'string') {
						flat.push(alt)
					} else {
						flat.push(...alt)
					}
				}
				return flat
			},
		})
		.option('combine', {
			alias: 'c',
			type: 'string',
			array: true,
			description: 'Pairs of GitHub usernames to consider equivalent. Useful for if you are querying across public and enterprise GitHub instances. The first name in the pair will be overridden by the second.\n'
		})
		.example('--combine TopSecretAnna PublicAnna', 'Any instance of TopSecretAnna will be considered as PublicAnna.\n')
		.option('label', {
			alias: 'l',
			type: 'string',
			description: 'GitHub issue label to indicate TPAC meeting-planning issues. Can be overridden per repo, via the --repo option.\n',
			default: 'tpac',
		})
		.option('meetings', {
			alias: 'm',
			type: 'string',
			description: 'Path to the local meetings schedule HTML file. It will be downloaded from the TPAC site if it doesn\'t exist.\n',
			required: true,
		})
		.option('output', {
			alias: 'o',
			type: 'string',
			description: 'Path to a local HTML file to create (or overwrite) with info on your planned meetings, and possible clashes.\n',
			required: true,
		})
		.option('repo', {
			alias: 'r',
			type: 'string',
			array: true,
			description: 'GitHub repo(s) containing TPAC meeting-planning issues. By default, the same label will be applied to all repo searches. If you want to use different labels for some repos, you can specify the label to use after the repo shortname/URL.\n\n(Not required if you are using the --query-results debugging option.)\n',
		})
		.example('--repo w3c/apa-tpac-meetings', 'Query the "w3c/apa-tpac-meetings" repo, use the default label, or that specified with the --label option.\n')
		.example('--repo w3c/apa --repo w3c/aria', 'Query multiple repos.\n')
		.example('--repo w3c/apa tpac-2025 --repo w3c/aria', 'Use a custom label for the "w3c/apa" repo.\n')
		.option('style', {
			alias: 's',
			type: 'string',
			description: 'Name of CSS file for styling the HTML output. This will be written directly into the output HTML, so that it\'s stand-alone.\n',
			default: 'style.css',
		})
		.option('year', {
			alias: 'y',
			choices: TpacYears,
			description: 'Which TPAC year to use (defaults to the latest year).\n',
			default: TpacYears.at(-1),
		})
		.option('query-result', {
			alias: 'q',
			type: 'string',
			description: 'Path to local JSON file that contains issues returned in GitHub API query responses. Overrides --repo.\n'
		})
		.option('save-result', {
			alias: 'S',
			type: 'string',
			description: 'Path to local JSON file to save all issues returned from all GitHub API query responses.\n',
		})
		.group(['meetings', 'output', 'repo'], 'Vital info:')
		.group(['alternatives', 'combine', 'label'], 'Issue/filtering options:')
		.group(['style'], 'Output options:')
		.group(['save-result', 'query-result', 'year'], 'Testing and debugging options:')
		.group(['help', 'version'], 'Workhorses:')
		.conflicts('query-result', 'save-result')
		.strict()
		.check(args => {
			if (!args.alternatives) args.alternatives = []
			return true
		})
		.check(args => {
			if (!args.repo && !args['query-result']) {
				throw new Error("One of '--repo' and '--query-result' must be supplied.")
			}
			return true
		})
		.parseSync()
}

function main() {
	const args = getArgs()
	const equivalents: CombinedNames = new Map()
	const issues: GhIssue[] = []
	const tpac = TPACs[`tpac${args.year!}`]
	const calendarMeetingInfo = makeCalendarMeetingInfoGetter(tpac.schedule, args.meetings)

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

		// FIXME: Figure out TypeScript/yargs workaround, and DRY with the above
		if (args.repo) {
			if (args.repo.length <= 2 && args.repo.every(value => typeof value === 'string')) {
				args.repo = [ args.repo ] as unknown as string[]
			}
			if (!args.repo.every(value =>
				Array.isArray(value) && value.length > 0 && value.length < 3)) {
				errorOut('Every \'repo\' option value must be either a GitHub repo, OR a GitHub repo and issue label to use when querying that repo. The values specified were:', args.repo)
			}
		}
		// NOTE: TypeScript doesn't seem to know it, but at this point we know that args.repo is an array of 1- or 2-value arrays.
		for (const repoLabel of args.repo) {
			issues.push(...getIssues(repoLabel[0]!, repoLabel[1] ?? args.label))
		}
	}

	if (issues.length === 0) {
		console.error('No issues found')
		return
	}

	const allMeetings = issues.map((issue =>
		meetingFromIssue(tpac.days, calendarMeetingInfo, issue)))

	const {
		validMeetings,
		// All of the rest are only used in the output stage
		cancelledMeetings,
		movedMeetings,
		invalidMeetings,
		unassignedMeetings,
	} = categoriseMeetings(allMeetings)

	const dayMeetings: DayMeetings = dayThings<Meeting>()
	const personDayMeetings: PersonDayMeetings = new Map()
	const personDayGaps: PersonDayGaps = new Map()
	const repoMeetings: RepoMeetings = new Map()

	// Track which people are assigned to which meetings, on which days.
	// Also track which meetings came from which repo (to flag possible duplicates).
	for (const meeting of validMeetings) {
		for (const name of meeting.names) {
			const normalisedName = equivalents.get(name) ?? name

			if (!personDayMeetings.has(normalisedName)) {
				personDayMeetings.set(normalisedName, dayThings())
			}
			personDayMeetings.get(normalisedName)?.get(meeting.day)?.push(meeting)

			if (!personDayGaps.has(normalisedName)) {
				personDayGaps.set(normalisedName, dayThings())
			}
		}

		addMeeting(dayMeetings, meeting.calendarDay, meeting)
		addMeeting(repoMeetings, repo(meeting.issueUrl), meeting)
	}

	// Now figure out, for each person, each day, and each meeting:
	// which other meetings they're assigned to clash for sure;
	// and which other meetings are very nearby, so may clash in practice.

	const peopleDefinitelyClashingMeetings: PersonClashingMeetings = new Map()
	const peopleNearlyClashingMeetings: PersonClashingMeetings = new Map()

	let haveDefinitelyClashing = false
	let haveNearlyClashing = false

	for (const [ person, dayMeetings ] of personDayMeetings) {
		for (const [ day, meetings ] of dayMeetings) {
			const workingDay = tpac.days[day]
			let endOfLastMeeting = workingDay.start

			for (const meeting of meetings) {
				// Detecting clashes
				for (const other of meetings) {
					if (meeting === other) continue

					// Cope with the case that the same meeting has been specified in multiple repos.
					if (sameActualMeeting(meeting, other)) continue

					switch (clashes(meeting, other)) {
						case Clash.DEFO:
							addClashingMeeting(peopleDefinitelyClashingMeetings, person, meeting, other)
							haveDefinitelyClashing = true
							break
						case Clash.NEAR:
							addClashingMeeting(peopleNearlyClashingMeetings, person, meeting, other)
							haveNearlyClashing = true
							break
					}
				}

				// Detecting gaps between meetings
				if (Temporal.PlainDateTime.compare(meeting.start, endOfLastMeeting) > 0) {
					personDayGaps.get(person)?.get(day)?.push({
						start: endOfLastMeeting,
						end: meeting.start,
					})
				}
				if (Temporal.PlainDateTime.compare(meeting.end, endOfLastMeeting) > 0) {
					endOfLastMeeting = meeting.end
				}
			}

			if (Temporal.PlainDateTime.compare(endOfLastMeeting, workingDay.end) < 0) {
				personDayGaps.get(person)?.get(day)?.push({
					start: endOfLastMeeting,
					end: workingDay.end,
				})
			}
		}
	}

	// Now we have been through all people, days, and meetings.
	// We can figure out, for all meetings, whom else could attend instead of those assigned.
	for (const meeting of validMeetings) {
		meeting.alternatives.push(...alternatives(args.alternatives!, personDayGaps, meeting))
	}

	// If multiple issues from the same repo reference the same meeting, they may be duplicates.
	// They may not be duplicates, though: they may reference different sub-parts of the same meeting.
	const repoPossibleDuplicates: RepoDuplicateMeetings = new Map()
	for (const [ repo, meetings ] of repoMeetings) {
		const grouped = Object.groupBy(meetings, meeting => meeting.calendarUrl)
		const possibleDupes = Object.values(grouped).filter(group => group && group.length > 1)
		if (possibleDupes.length > 0) {
			// TODO: the handling of undefined as a possibility seems a bit kludgy here
			repoPossibleDuplicates.set(repo, possibleDupes.filter(v => !!v))
		}
	}

	const html = makeHtml(invalidMeetings,
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
		args.style,
		MY_NAME)

	fs.writeFileSync(args.output, html)
	console.log('Written', args.output + '.')
	if (args.saveResult) {
		fs.writeFileSync(args.saveResult, JSON.stringify(issues, null, 2))
		console.log('Written', args.saveResult + '.')
	}
}

main()
