#!/usr/bin/env node
import fs from 'fs'
import { spawnSync } from 'child_process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Temporal } from '@js-temporal/polyfill'

import ClashingMeetingsSet from './src/clashing-meetings-set.ts'
import { makeCalendarMeetingInfoGetter } from './src/calendar-meeting-info.ts'
import { Days, isDay } from './src/day.ts'
import { makeHtml } from './src/html.ts'

import type { Day } from './src/day.ts'
import type { GetCalendarMeetingInfo } from './src/calendar-meeting-info.ts'
import type { Kind } from './src/kind.ts'

const SCHEDULE_URL = 'https://www.w3.org/2025/11/TPAC/schedule.html'

export type CombinedNames = Map<string, string>
type DayThings<T> = Map<Day, T[]>
export type DayMeetings = DayThings<Meeting>
export type DayGaps = DayThings<Gap>
export type PersonDayMeetings = Map<string, DayMeetings>
export type PersonClashingMeetings = Map<string, ClashingMeetingsSet>
export type PersonDayGaps = Map<string, DayGaps>
export type RepoMeetings = Map<string, Meeting[]>
export type RepoDuplicateMeetings = Map<string, Meeting[][]>

interface WorkingDay {
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
}

export const Match = {
	EXACT: 'exact',
	SUBSET: 'subset',
	NOPE: 'nope',
} as const
type MatchStatus = typeof Match[keyof typeof Match]

const Clash = {
	NONE: 'No clash',
	DEFO: 'CLASHES!',
	NEAR: 'Mind Gap',
} as const
type ClashStatus = typeof Clash[keyof typeof Clash]

interface GhIssue {
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

interface GhBodyInfo {
	calendarUrl: string
	day: Day
	startOfDay: Temporal.PlainDateTime
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
	extraPeople: string[]  // Hack around 10-assignee limit
	notes?: string
}

export interface Meeting {
	tag: number
	kind: Kind
	calendarTitle: string
	title: string
	calendarDay: Day
	day: Day
	calendarStart: Temporal.PlainDateTime
	start: Temporal.PlainDateTime
	calendarEnd: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
	match: MatchStatus
	calendarRoom: string
	names: string[]
	calendarUrl: string
	issueUrl: string
	alternatives: string[]
	notes?: string
}

export interface Gap {
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
}

const myName = 'TPAC scheduling helper'
let meetingCounter = 1
let calendarMeetingInfo: GetCalendarMeetingInfo

export function sort(activities: (Meeting | Gap)[]) {
	activities.sort((a, b) => Temporal.PlainDateTime.compare(a.start, b.start))
}

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

function sameActualMeeting(meeting: Meeting, other: Meeting) {
	return meeting.calendarUrl === other.calendarUrl &&
		meeting.start.equals(other.start) &&
		meeting.end.equals(other.end)
}

function addDayMeeting(map: Map<Day, Meeting[]>, day: Day, meeting: Meeting) {
	if (map.has(day)) {
		map.get(day)!.push(meeting)
	} else {
		map.set(day, [ meeting ])
	}
}

function addRepoMeeting(map: Map<string, Meeting[]>, repo: string, meeting: Meeting) {
	if (map.has(repo)) {
		map.get(repo)!.push(meeting)
	} else {
		map.set(repo, [ meeting ])
	}
}

function addClashingMeeting(map: Map<string, ClashingMeetingsSet>, name: string, m: Meeting, o: Meeting) {
	if (!map.has(name)) {
		map.set(name, new ClashingMeetingsSet())
	}
	map.get(name)!.add(m, o)
}

function timeStringToPlainDateTime(startOfDay: Temporal.PlainDateTime, time: string): Temporal.PlainDateTime {
	const [ hours, minutes ] = time.split(':').map(s => parseInt(s))
	return startOfDay.add(Temporal.Duration.from({ hours, minutes }))
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

function extractBodyInfo(body: string): Partial<GhBodyInfo> {
	// GitHub API line-ending weirdness: https://github.com/actions/runner/issues/1462#issuecomment-2676329157
	const bodyLines = body.split(/\r?\n/)

	const calendarUrl = bodyLines.shift()
	const rawDay = bodyLines.shift()?.toLowerCase()
	const day = isDay(rawDay) ? rawDay : undefined
	const startOfDay = day ? startOfDayFrom(day) ?? undefined : undefined
	const time = bodyLines.shift()
	const startAndEnd = startOfDay ? time?.split(/ ?[–-] ?/).map(tstr => timeStringToPlainDateTime(startOfDay, tstr)) : []
	const start = startAndEnd?.[0]
	const end = startAndEnd?.[1]
	const extraPeopleOrBlank = bodyLines.shift()
	const haveExtraLine = extraPeopleOrBlank && extraPeopleOrBlank.length > 0

	const extraPeople = haveExtraLine
		? extraPeopleOrBlank.replaceAll(',', '').replaceAll('@', '').split(/\s/)
		: []

	if (haveExtraLine) bodyLines.shift()  // Blank line after metadata

	return { calendarUrl, day, startOfDay, start, end, extraPeople, notes: bodyLines.join('\n') }
}

function isMeeting(p: Partial<Meeting>): p is Meeting {
	return !!p.tag &&
		!!p.kind &&
		!!p.calendarTitle &&
		!!p.title &&
		!!p.calendarDay &&
		!!p.day &&
		!!p.calendarStart &&
		!!p.start &&
		!!p.calendarEnd &&
		!!p.end &&
		!!p.match &&
		!!p.calendarRoom &&
		!!p.names &&
		!!p.calendarUrl &&
		!!p.issueUrl &&
		!!p.alternatives
}

function meetingFromIssue(getter: GetCalendarMeetingInfo, issue: GhIssue): Meeting | Partial<Meeting> {
	const bodyInfo = extractBodyInfo(issue.body)
	bodyInfo.extraPeople ??= []

	const names = issue.assignees.map(assignee => assignee.login)
	const calendarInfo = getter(bodyInfo.calendarUrl ?? '')

	const startOfDay = calendarInfo?.day ?
		startOfDayFrom(calendarInfo.day) : undefined
	const calendarStart = startOfDay && calendarInfo?.start ?
		timeStringToPlainDateTime(startOfDay, calendarInfo.start) : undefined
	const calendarEnd = startOfDay && calendarInfo?.end ?
		timeStringToPlainDateTime(startOfDay, calendarInfo.end) : undefined
	const match = calendarStart && calendarEnd && bodyInfo.start && bodyInfo.end ?
		timeMatch(calendarStart, calendarEnd, bodyInfo.start, bodyInfo.end) : undefined

	return {
		tag: meetingCounter++,
		kind: calendarInfo?.kind,
		calendarTitle: calendarInfo?.title,
		title: issue.title,
		calendarDay: calendarInfo?.day,
		day: bodyInfo.day,
		calendarStart,
		start: bodyInfo.start,
		calendarEnd,
		end: bodyInfo.end,
		match,
		calendarRoom: calendarInfo?.room,
		names: Array.from(new Set([ ...names, ...bodyInfo.extraPeople ])),
		calendarUrl: bodyInfo.calendarUrl,
		issueUrl: issue.url,
		alternatives: [], // NOTE: Only known after computing clashes and free times
		notes: bodyInfo.notes,
	}
}

function timeMatch(calendarStart: Temporal.PlainDateTime, calendarEnd: Temporal.PlainDateTime, ourStart: Temporal.PlainDateTime, ourEnd: Temporal.PlainDateTime): MatchStatus {
	const start = Temporal.PlainDateTime.compare(calendarStart, ourStart)
	const end = Temporal.PlainDateTime.compare(calendarEnd, ourEnd)

	if (start === 0 && end === 0) return Match.EXACT
	if (start <= 0 && end >= 0) return Match.SUBSET
	return Match.NOPE
}

function alternatives(alts: string[], pdg: PersonDayGaps, m: Meeting): string[] {
	const out: string[] = []

	for (const name of pdg.keys()) {
		if (m.names.includes(name)) continue
		if (alts.length > 0 && !alts.includes(name)) continue
		for (const gap of pdg.get(name)?.get(m.day) ?? []) {
			if (isMeetingInGap(m, gap)) {
				out.push(name)
			}
		}
	}

	return out
}

// FIXME: Take gaps into account; maybe DRY with below
function isMeetingInGap(m: Meeting, g: Gap): boolean {
	const buffer = Temporal.Duration.from({ minutes: 10 })  // FIXME: DRY
	return Temporal.PlainDateTime.compare(m.start, g.start) >= 0
		  && Temporal.PlainDateTime.compare(m.start, g.end)   <= 0
		  && Temporal.PlainDateTime.compare(m.end,   g.start) >= 0
	    && Temporal.PlainDateTime.compare(m.end,   g.end)   <= 0
}

function clashes(a: Meeting, b: Meeting): ClashStatus {
	const gap = Temporal.Duration.from({ minutes: 10 })  // FIXME: DRY

	// TODO: Check if can be removed
	const meetings = [ a, b ]
	sort(meetings)
	const [ m, o ] = meetings

	if (Temporal.PlainDateTime.compare(m.start, o.start) >= 0
	 && Temporal.PlainDateTime.compare(m.start, o.end)   <= 0) return Clash.DEFO

	// NOTE: Allow first meeting that ends as the second one starts to be a near clash
	if (Temporal.PlainDateTime.compare(m.end,   o.start) >  0
	 && Temporal.PlainDateTime.compare(m.end,   o.end)   <= 0) return Clash.DEFO

	if (Temporal.PlainDateTime.compare(m.start, o.start.subtract(gap)) >= 0
	 && Temporal.PlainDateTime.compare(m.start, o.end.add(gap))        <= 0) return Clash.NEAR

	if (Temporal.PlainDateTime.compare(m.end,   o.start.subtract(gap)) >= 0
	 && Temporal.PlainDateTime.compare(m.end,   o.end.add(gap))        <= 0) return Clash.NEAR

	return Clash.NONE
}

function startOfDayFrom(candidate: Day): Temporal.PlainDateTime {
	switch (candidate) {
		case 'monday':
			return new Temporal.PlainDateTime(2025, 11, 10)
		case 'tuesday':
			return new Temporal.PlainDateTime(2025, 11, 11)
		case 'wednesday':
			return new Temporal.PlainDateTime(2025, 11, 12)
		case 'thursday':
			return new Temporal.PlainDateTime(2025, 11, 13)
		case 'friday':
			return new Temporal.PlainDateTime(2025, 11, 14)
	}
}

function workingDayFrom(day: Day): WorkingDay {
	const midnight = startOfDayFrom(day)
	return {
		start: midnight.add(Temporal.Duration.from({ hours: 8, minutes: 30 })),
		end: midnight.add(Temporal.Duration.from({ hours: 22, minutes: 30 })),
	}
}

function getArgs() {
	return yargs(hideBin(process.argv)).parserConfiguration({
		'flatten-duplicate-arrays': false,
	})
		.usage(myName + '\n\nUsage: $0 [options]')
		.option('alternatives', {
			alias: 'a',
			type: 'string',
			array: true,
			description: 'People who you want to consider as possible alternatives to attend meetings, in the event of clashes. By default, all people referenced by issues will be considered as possible alternative meeting attendees.',
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
			description: 'Pairs of GitHub usernames to consider equivalent. Useful for if you are querying across public and enterprise GitHub instances. The first name in the pair will be overridden by the second.',
		})
		.option('label', {
			alias: 'l',
			type: 'string',
			description: 'GitHub issue label to indicate TPAC meeting-planning issues',
			default: 'tpac',
		})
		.option('meetings', {
			alias: 'm',
			type: 'string',
			description: 'Path to local meetings schedule HTML file - it will be downloaded if it doesn\'t exist',
			required: true,
		})
		.option('output', {
			alias: 'o',
			type: 'string',
			description: 'Path to HTML file to create with info on all the meetings',
			required: true,
		})
		.option('query-result', {
			alias: 'q',
			type: 'string',
			description: 'Path to local JSON file that contains issues returned in GitHub API query responses (for debugging)',
		})
		.option('repo', {
			alias: 'r',
			type: 'string',
			array: true,
			description: 'GitHub repo(s) containing TPAC meeting-planning issues. By default, the same label will be applied to all repo searches. If you want to use different labels for some repos, you can specify the label to use after the repo shortname/URL.',
		})
		.option('save-result', {
			alias: 'S',
			type: 'string',
			description: 'Path to local JSON file to save all issues returned from all GitHub API query responses (for debugging)',
		})
		.option('style', {
			alias: 's',
			type: 'string',
			description: 'Name of CSS file for styling the HTML output. This will be written directly into the output HTML.',
			default: 'style.css',
		})
		.conflicts('query-result', 'save-result')
		.strict()
		.check(args => {
			if (!args.alternatives) args.alternatives = []
			return true
		})
		.parseSync()
}

function main() {
	const args = getArgs()
	const equivalents: CombinedNames = new Map()

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
			equivalents.set(name, otherName)
		}
	}

	calendarMeetingInfo = makeCalendarMeetingInfoGetter(SCHEDULE_URL, args.meetings)

	const issues: GhIssue[] = []

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
			issues.push(...getIssues(repoLabel[0], repoLabel[1] ?? args.label))
		}
	}

	if (issues.length === 0) {
		console.error('No issues found')
		return
	}
	console.log()

	const meetings: Meeting[] = []
	const cancelledMeetings: Partial<Meeting>[] = []
	const invalidMeetings: Partial<Meeting>[] = []
	const movedMeetings: Meeting[] = []
	const unassignedMeetings: Meeting[] = []

	for (const issue of issues) {
		const meeting = meetingFromIssue(calendarMeetingInfo, issue)
		if (isMeeting(meeting)) {
			if (meeting.match === Match.NOPE) {
				movedMeetings.push(meeting)
			} else {
				meetings.push(meeting)
			}
			if (meeting.names.length === 0) {
				unassignedMeetings.push(meeting)
			}
		} else if (meeting?.kind === 'cancelled') {
			cancelledMeetings.push(meeting)
		} else {
			invalidMeetings.push(meeting)
		}
	}

	sort(meetings)
	sort(movedMeetings)
	sort(unassignedMeetings)

	const dayMeetings: DayMeetings = dayThings<Meeting>()
	const personDayMeetings: PersonDayMeetings = new Map()
	const personDayGaps: PersonDayGaps = new Map()
	const repoMeetings: RepoMeetings = new Map()

	for (const meeting of meetings) {
		for (const name of meeting.names) {
			const equiv = equivalents.get(name) ?? name

			if (!personDayMeetings.has(equiv)) {
				personDayMeetings.set(equiv, dayThings())
			}
			personDayMeetings.get(equiv)?.get(meeting.day)?.push(meeting)

			if (!personDayGaps.has(equiv)) {
				personDayGaps.set(equiv, dayThings())
			}
		}

		addDayMeeting(dayMeetings, meeting.calendarDay, meeting)
		addRepoMeeting(repoMeetings, repo(meeting.issueUrl), meeting)
	}

	const peopleDefinitelyClashingMeetings: PersonClashingMeetings = new Map()
	const peopleNearlyClashingMeetings: PersonClashingMeetings = new Map()

	let haveDefinitelyClashing = false
	let haveNearlyClashing = false

	for (const [ name, dayMeetings ] of personDayMeetings) {
		for (const [ day, meetings ] of dayMeetings) {
			const workingDay = workingDayFrom(day)
			let endOfLastMeeting = workingDay.start

			for (const meeting of meetings) {
				// Detecting clashes
				for (const other of meetings) {
					if (meeting === other) continue

					// Cope with the case that the same meeting has been specified in multiple repos.
					if (sameActualMeeting(meeting, other)) continue

					switch (clashes(meeting, other)) {
						case Clash.DEFO:
							addClashingMeeting(peopleDefinitelyClashingMeetings, name, meeting, other)
							haveDefinitelyClashing = true
							break
						case Clash.NEAR:
							addClashingMeeting(peopleNearlyClashingMeetings, name, meeting, other)
							haveNearlyClashing = true
							break
					}
				}

				// Detecting gaps between meetings
				if (Temporal.PlainDateTime.compare(meeting.start, endOfLastMeeting) > 0) {
					personDayGaps.get(name)?.get(day)?.push({
						start: endOfLastMeeting,
						end: meeting.start,
					})
				}
				if (Temporal.PlainDateTime.compare(meeting.end, endOfLastMeeting) > 0) {
					endOfLastMeeting = meeting.end
				}
			}

			if (Temporal.PlainDateTime.compare(endOfLastMeeting, workingDay.end) < 0) {
				personDayGaps.get(name)?.get(day)?.push({
					start: endOfLastMeeting,
					end: workingDay.end,
				})
			}
		}
	}

	for (const meeting of meetings) {
		meeting.alternatives.push(...alternatives(args.alternatives!, personDayGaps, meeting))
	}

	const repoPossibleDuplicates: RepoDuplicateMeetings = new Map()
	for (const [ repo, meetings ] of repoMeetings) {
		const grouped = Object.groupBy(meetings, meeting => meeting.calendarUrl)
		const possibleDupes = Object.values(grouped).filter(group => group && group.length > 1)
		if (possibleDupes.length > 0) {
			// TODO: the handling of undefined as a possibility seems a bit kludgy here
			repoPossibleDuplicates.set(repo, possibleDupes.filter(v => !!v))
		}
	}

	const html = makeHtml(invalidMeetings, meetings, movedMeetings, repoPossibleDuplicates, unassignedMeetings, cancelledMeetings, peopleNearlyClashingMeetings, peopleDefinitelyClashingMeetings, personDayMeetings, equivalents, dayMeetings, haveDefinitelyClashing, haveNearlyClashing, personDayGaps, args.style, myName)

	fs.writeFileSync(args.output, html)
	console.log('Written', args.output)
	if (args.saveResult) {
		fs.writeFileSync(args.saveResult, JSON.stringify(issues, null, 2))
		console.log('Written', args.saveResult)
	}
}

main()
