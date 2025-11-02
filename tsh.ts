#!/usr/bin/env node
import * as fs from 'fs'
import { spawnSync } from 'child_process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { JSDOM } from 'jsdom'
import { Temporal } from '@js-temporal/polyfill'

const SCHEDULE_URL = 'https://www.w3.org/2025/11/TPAC/schedule.html'

type CombinedNames = Map<string, string>
type DayThings<T> = Map<Day, T[]>
type DayMeetings = DayThings<Meeting>
type DayGaps = DayThings<Gap>
type PersonDayMeetings = Map<string, DayMeetings>
type PersonClashingMeetings = Map<string, ClashingMeetingsSet>
type PersonDayGaps = Map<string, DayGaps>
type RepoMeetings = Map<string, Meeting[]>
type RepoDuplicateMeetings = Map<string, Meeting[][]>

const Days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const
type Day = typeof Days[number]

const Kinds = ['group', 'breakout', 'invalid', 'cancelled'] as const
type Kind = typeof Kinds[number]

type WorkingDay = {
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
}

const Match = {
	EXACT: 'exact',
	SUBSET: 'subset',
	NOPE: 'nope'
} as const
type MatchStatus = typeof Match[keyof typeof Match]

const Clash = {
	NONE: 'No clash',
	DEFO: 'CLASHES!',
	NEAR: 'Mind Gap'
} as const
type ClashStatus = typeof Clash[keyof typeof Clash]

type GhIssue = {
	assignees: GhAssignee[]
	body: string
	title: string
	url: string
}

type GhAssignee = {
	id: string
	login: string
	name: string
	databaseId: number
}

type GhBodyInfo = {
	calendarUrl: string
	day: Day
	startOfDay: Temporal.PlainDateTime
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
	extraPeople: string[]  // Hack around 10-assignee limit
	notes?: string
}

type CalendarMeetingInfo = {
	title: string
	day: Day
	start: string
	end: string
	room: string
	kind: Kind
}

type Meeting = {
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

type Gap = {
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
}

const myName = 'TPAC scheduling helper'
let meetingCounter = 1

class ClashingMeetingsSet {
	#idPairs: Set<string>
	#meetingPairs: [Meeting, Meeting][]

	constructor() {
		this.#idPairs = new Set()
		this.#meetingPairs = []
	}

	add(a: Meeting, b: Meeting) {
		const sorted = [a, b].sort((a, b) => a.tag - b.tag)
		if (sorted.length !== 2) throw('Sorted pair is not of length 2:' + sorted)
		const ident = sorted.map(m => m.tag).join(':')
		if (!this.#idPairs.has(ident)) {
			this.#idPairs.add(ident)
			this.#meetingPairs.push([sorted[0], sorted[1]])
		}
	}

	get size() {
		return this.#meetingPairs.length
	}

	[Symbol.iterator]() {
		return this.#meetingPairs[Symbol.iterator]()
	}
}

function sort(activities: (Meeting | Gap)[]) {
	activities.sort((a, b) => Temporal.PlainDateTime.compare(a.start, b.start))
}

function dayThings<T extends Meeting | Gap>(): Map<Day, T[]> {
	return new Map(Days.map(day => [day, []]))
}

function errorOut(...args: any) {
	console.error(...args)
	process.exit(42)
}

function sameActualMeeting(meeting: Meeting, other: Meeting) {
	return meeting.calendarUrl === other.calendarUrl &&
		meeting.start.equals(other.start) &&
		meeting.end.equals(other.end)
}

function people(names: string[], combined: CombinedNames): string {
	return names.map(name => combined.has(name)
		? combined.get(name) + ' (' + name + ')'
		: name).join(', ')
}

function repo(issueUrl: string): string {
	return issueUrl.slice(19).split('/').slice(0, -2).join('/')
}

function peopleSelector(pms: PersonDayMeetings): string {
	if (pms.size === 0) return ''
	let html = '<label>Show clashing meetings for <select><option selected>everyone</option>'
	pms.forEach((_, name) => html += `<option value="${name}">${name}</option>`)
	return html + '</select></label>'
}

function peopleSelectorStyle(pms: PersonDayMeetings): string {
	let html = `<style>
		section[data-person] {
			display: none;
		}

		body:has(select > option:not([value]):checked) section[data-person] {
			display: block;
		}`

	pms.forEach((_, name) => {
		html += `body:has(select > option[value="${name}"]:checked) section[data-person="${name}"] {
			display: block;
		}`
	})

	return html + '</style>'
}

function sectionLink(flag: boolean, idref: string, pretty: string) {
	return flag
		? `<a href="#${idref}">${pretty}</a>`
		: `${pretty} (none)`
}

function addDayMeeting(map: Map<Day, Meeting[]>, day: Day, meeting: Meeting) {
	if (map.has(day)) {
		map.get(day)!.push(meeting)
	} else {
		map.set(day, [meeting])
	}
}

function addRepoMeeting(map: Map<string, Meeting[]>, repo: string, meeting: Meeting) {
	if (map.has(repo)) {
		map.get(repo)!.push(meeting)
	} else {
		map.set(repo, [meeting])
	}
}

function addClashingMeeting(map: Map<string, ClashingMeetingsSet>, name: string, m: Meeting, o: Meeting) {
	if (!map.has(name)) {
		map.set(name, new ClashingMeetingsSet())
	}
	map.get(name)!.add(m, o)
}

function dtf(pdt: Temporal.PlainDateTime): string {
	return pdt.toLocaleString(undefined, {
		hour: '2-digit',
		minute: '2-digit'
	})
}

function isDay(candidate: any): candidate is Day {
	return Days.includes(candidate)
}

function pretty(thing: string): string {
	return thing.charAt(0).toUpperCase() + thing.slice(1)
}

function timeStringToPlainDateTime(startOfDay: Temporal.PlainDateTime, time: string): Temporal.PlainDateTime {
	const [hours, minutes] = time.split(':').map(s => parseInt(s))
	return startOfDay.add(Temporal.Duration.from({ hours, minutes }))
}

function getSchedule(path: string) {
	if (!fs.existsSync(path)) {
		console.log('Downloading schedule...')
		const child = spawnSync('curl', [SCHEDULE_URL, '-o', path])
		if (child.error) {
			throw (child.stderr)
		}
	}
	return fs.readFileSync(path, 'utf-8')
}

function getIssues(repo: string, label: string): GhIssue[] {
	const cmd = 'gh'
	const args = ['--repo', repo, 'issue', 'list', '--label', label, '--json', 'assignees,body,title,url', '--limit', '999']
	console.log(cmd, args.join(' '))
	const child = spawnSync(cmd, args)
	if (child.error) {
		errorOut('Error reported by gh:', child.stderr)
	}
	try {
		return JSON.parse(child.stdout.toString())
	} catch (err) {
		errorOut('Error parsing GitHub API result:', err instanceof Error ? err.message : err)
	}
	return []  // NOTE: Here for TypeScript
}

function extractBodyInfo(body: String): Partial<GhBodyInfo> {
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

function meetingFromIssue(doc: Document, issue: GhIssue): Meeting | Partial<Meeting> {
	const bodyInfo = extractBodyInfo(issue.body)
	bodyInfo.extraPeople ??= []

	const names = issue.assignees.map(assignee => assignee.login)
	const calendarInfo = calendarMeetingInfo(doc, bodyInfo.calendarUrl ?? '')

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
		names: Array.from(new Set([...names, ...bodyInfo.extraPeople])),
		calendarUrl: bodyInfo.calendarUrl,
		issueUrl: issue.url,
		alternatives: [], // NOTE: Only known after computing clashes and free times
		notes: bodyInfo.notes
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
	let out: string[] = []

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
	const meetings = [a, b]
	sort(meetings)
	const [m, o] = meetings

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

function display(meeting: Meeting, combined: CombinedNames) {
	console.log('      tag:', meeting.tag)
	console.log('     kind:', meeting.kind)
	console.log(`Cal title: ${meeting.calendarTitle}`)
	console.log(`Our title: ${meeting.title}`)
	console.log('     Repo:', repo(meeting.issueUrl))

	if (meeting.match === Match.NOPE) {
		console.log('  Cal day:', pretty(meeting.calendarDay))
		console.log('  Our day:', pretty(meeting.day))
	} else {
		console.log('      Day:', pretty(meeting.day))
	}

	if (meeting.match !== Match.EXACT) {
		console.log(' Cal time:', dtf(meeting.calendarStart), '-', dtf(meeting.calendarEnd))
		console.log(' Our time:', dtf(meeting.start), '-', dtf(meeting.end))
	} else {
		console.log('     Time:', dtf(meeting.start), '-', dtf(meeting.end))
	}

	console.log('     Room:', meeting.calendarRoom)
	console.log('   People:', people(meeting.names, combined))
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.issueUrl)
	console.log('    Match:', pretty(meeting.match))

	console.log('     alts:', prettyAlts(meeting))
}

// TODO: DRY with above? Would this ever need to display notes, or alternatives?
function displayPartial(meeting: Partial<Meeting>, combined: CombinedNames) {
	console.log('      tag:', meeting.tag)
	console.log('     kind:', meeting.kind)
	console.log(`Cal title: ${meeting.calendarTitle}`)
	console.log(`Our title: ${meeting.title}`)
	console.log('     Repo:', meeting.issueUrl ? repo(meeting.issueUrl) : null)

	console.log('  Cal day:', meeting.calendarDay ? pretty(meeting.calendarDay) : null)
	console.log('  Our day:', meeting.day ? pretty(meeting.day) : null)

	console.log(' Cal time:', meeting.calendarStart ? dtf(meeting.calendarStart) : '??', '-', meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??')
	console.log(' Our time:', meeting.start ? dtf(meeting.start) : '??', '-', meeting.end ? dtf(meeting.end) : '??')

	console.log('     Room:', meeting.calendarRoom ?? null)
	console.log('   People:', meeting.names ? people(meeting.names, combined) : null)
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.issueUrl)
}

function outputTimetable(pdm: PersonDayMeetings, pdg: PersonDayGaps, combined: CombinedNames) {
	let html = `<table>
		<thead>
			<tr>
				<th><p>Person</p></th>
				<th><p>Monday</p></th>
				<th><p>Tuesday</p></th>
				<th><p>Wednesday</p></th>
				<th><p>Thursday</p></th>
				<th><p>Friday</p></th>
			</tr>
		</thead>
		<tbody>`

	for (const [name, dayGaps] of pdg) {
		console.log(`// Timetable for ${name}`)
		html += `<tr><th scope="row">${name}</th>`
		console.log()
		for (const [day, gaps] of dayGaps) {
			console.log(pretty(day))
			html += '<td><ul>'

			// TODO: TS can't infer type
			const activities: (Meeting | Gap)[] = [...pdm.get(name)?.get(day) ?? [], ...gaps]
			sort(activities)

			for (const activity of activities) {
				if ('kind' in activity) {
					console.log(activity.calendarTitle)
					html += listItemFor(activity, false, combined, name)
				} else {
					console.log('Free from', dtf(activity.start), 'to', dtf(activity.end))
					html += `<li><p>Free ${dtf(activity.start)} to ${dtf(activity.end)}</p></li>`
				}
			}

			html += '</ul></td>'
			console.log()
		}
		html += '</tr>'
		console.log()
	}

	return html + '</tbody></table>'
}

function htmlPeopleAndUrls(meeting: Partial<Meeting>, combined: CombinedNames): string {
	let out = ''
	out += `<dt>Room</dt><dd>${meeting.calendarRoom ?? '???'}</dd>`
	out += `<dt>People</dt><dd>${meeting.names ? people(meeting.names, combined) : '???'}</dd>`
	out += `<dt>Calendar URL</dt><dd><a href="${meeting.calendarUrl}">${meeting.calendarUrl}</a></dd>`
	out += `<dt>Our issue URL</dt><dd><a href="${meeting.issueUrl}">${meeting.issueUrl}</a></dd>`
	return out
}

function htmlNotes(meeting: Partial<Meeting>): string {
	if (meeting.notes) {
		return `<details>
			<summary>Meeting notes</summary>
			<pre>${meeting.notes}</pre>
		</details>`
	}
	return ''
}

function listItemFor(meeting: Meeting, includeDay: boolean, combined: CombinedNames, skipName?: string): string {
	return `<li><p>${oneLinerFor(meeting, includeDay, combined, skipName)}</p></li>`
}

function oneLinerFor(meeting: Meeting, includeDay: boolean, combned: CombinedNames, skipName?: string): string {
	const maybeDay = includeDay ? pretty(meeting.calendarDay) + ' ' : ''
	const names = skipName
		? meeting.names.filter(name => name !== skipName)
		: meeting.names
	const nameHtml = names.length > 0
		? `, <i>${people(names, combned)}</i>`
		: ''
	return `<a href="#${meeting.tag}">${meeting.calendarTitle}</a>, <b>${maybeDay}${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</b>, ${meeting.calendarRoom}${nameHtml}`
}

function htmlMeetingHeader(meeting: Partial<Meeting>, condition: string): string {
	return `<div id="${meeting.tag}" class="meeting ${condition}">
		<h4>${meeting.calendarTitle}</h4>
		<p><i>${meeting.title}</i> <span>from: ${meeting.issueUrl ? repo(meeting.issueUrl) : null}</span></p>
		<dl>
			<dt>Kind</dt><dd>${meeting.kind}</dd>`
}

function htmlForMeeting(meeting: Meeting, combined: CombinedNames): string {
	let out = ''

	if (meeting.match === Match.NOPE && meeting.day !== meeting.calendarDay) {
		out += `<dt>Calendar day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
		out += `<dt>Our day</dt><dd>${pretty(meeting.day)}</dd>`
	} else {
		out += `<dt>Day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
	}

	if (meeting.match !== Match.EXACT) {
		out += `<dt>Calendar time</dt><dd>${dtf(meeting.calendarStart)}&ndash;${dtf(meeting.calendarEnd)}</dd>`
		out += `<dt>Our time</dt><dd>${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</dd>`
	} else {
		out += `<dt>Time</dt><dd>${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</dd>`
	}

	out += htmlPeopleAndUrls(meeting, combined)
	out += `<dt>Time match</dt><dd>${pretty(meeting.match)}</dd>`
	out += `<dt>Alternatives</dt><dd>${prettyAlts(meeting)}</dd>`
	out += '</dl>'

	out += htmlNotes(meeting)

	out += '</div>'

	// TODO: Make the mapping of condition to string more type-y?
	return htmlMeetingHeader(meeting, meeting.match) + out
}

function htmlForPartialMeeting(meeting: Partial<Meeting>, combined: CombinedNames): string {
	let out = htmlMeetingHeader(meeting, 'invalid')

	out += `<dt>Calendar day</dt><dd>${meeting.calendarDay ? pretty(meeting.calendarDay) : '???'}</dd>`
	out += `<dt>Our day</dt><dd>${meeting.day ? pretty(meeting.day) : '???'}</dd>`

	out += `<dt>Calendar time</dt><dd>${meeting.calendarStart ? dtf(meeting.calendarStart) : '??'}&ndash;${meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??'}</dd>`
	out += `<dt>Our time</dt><dd>${meeting.start ? dtf(meeting.start) : '??'}&ndash;${meeting.end ? dtf(meeting.end) : '??'}</dd>`

	out += htmlPeopleAndUrls(meeting, combined)

	out += '</dl>'
	out += htmlNotes(meeting)

	out += '</div>'

	return out
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
		start: midnight.add(Temporal.Duration.from({ hours: 9 })),
		end: midnight.add(Temporal.Duration.from({ hours: 18 })),
	}
}

function calendarMeetingInfo(doc: Document, url: String): Partial<CalendarMeetingInfo> | null {
	const link = doc.querySelector(`a[href="${url}"]`)
	if (!link) return null

	const parentSection = (link?.parentElement?.parentElement?.parentElement)
	const rawDay = parentSection?.id

	const title = link?.firstElementChild?.textContent
	const start = link?.children[4].children[0].textContent
	const end = link?.children[4].children[1].textContent
	const room = link?.children[2].textContent
	const kind = link?.classList.contains('breakout') ? 'breakout' : 'group'

	return { title, day: isDay(rawDay) ? rawDay : undefined, start, end, room, kind }
}

function prettyAlts(m: Meeting): string {
	return m.alternatives.length > 0 ? m.alternatives.join(', ') : '(none)'
}

function htmlAlternativesOrNot(m: Meeting): string {
	if (m.alternatives.length > 0) return `<p><strong>Possible alternative attendees:</strong> ${prettyAlts(m)}</p>`
	return ''
}

function outputClashingMeetings(pcm: PersonClashingMeetings, kind: string, combined: CombinedNames): string {
	let html = ''
	for (const [name, cms] of pcm) {
		console.log(`// ${kind} clashing meetings for ${name}`)
		console.log()
		if (cms.size) {
			html += `<section data-person="${name}">`
			html += `<h3>${kind} clashing meetings for ${name}</h3><ul class="clashing">`
			for (const [m, o] of cms) {
				display(m, combined)
				console.log('...and...')
				display(o, combined)
				html += `<li>
					<p>${oneLinerFor(m, true, combined, name)}</p>${htmlAlternativesOrNot(m)}
					<p>and</p>
					<p>${oneLinerFor(o, true, combined, name)}</p>${htmlAlternativesOrNot(o)}</li>`
				console.log()
			}
			html += '</ul>'
			html += '</section>'
			console.log()
		}
	}
	return html
}

function outputPossibleDuplicateMeetings(rdm: RepoDuplicateMeetings, combined: CombinedNames): string {
	let html = ''
	for (const [repo, possibleDupes] of rdm) {
		console.log(`// Possible duplicate meetings in ${repo}`)
		console.log()
		html += `<h3>Possibly duplicate meetings in ${repo}</h3>`
		for (const [index, meetings] of possibleDupes.entries()) {
			html += `<p>Set of possible duplicates ${index + 1}:</p>`
			html += '<ul>'
			for (const m of meetings) {
				display(m, combined)
				html += `<li><p>${oneLinerFor(m, true, combined)}</p></li>`
				console.log()
			}
			html += '</ul>'
		}
		console.log()
	}
	return html
}

function outputUnassignedMeetings(unassigned: Meeting[], combined: CombinedNames): string {
	let html = ''
	console.log(`// Meetings without any assignees`)
	console.log()
	html += '<ul>'
	for (const meeting of unassigned) {
		display(meeting, combined)
		html += `<li><p>${oneLinerFor(meeting, true, combined)}</p></li>`
		console.log()
	}
	html += '</ul>'
	console.log()
	return html
}

function getArgs() {
	return yargs(hideBin(process.argv)).parserConfiguration({
		'flatten-duplicate-arrays': false
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
			}
		})
		.option('combine', {
			alias: 'c',
			type: 'string',
			array: true,
			description: 'Pairs of GitHub usernames to consider equivalent. Useful for if you are querying across public and enterprise GitHub instances. The first name in the pair will be overridden by the second.'
		})
		.option('label', {
			alias: 'l',
			type: 'string',
			description: 'GitHub issue label to indicate TPAC meeting-planning issues',
			default: 'tpac'
		})
		.option('meetings', {
			alias: 'm',
			type: 'string',
			description: "Path to local meetings schedule HTML file - it will be downloaded if it doesn't exist",
			required: true
		})
		.option('output', {
			alias: 'o',
			type: 'string',
			description: 'Path to HTML file to create with info on all the meetings',
			required: true
		})
		.option('query-result', {
			alias: 'q',
			type: 'string',
			description: 'Path to local JSON file that contains issues returned in GitHub API query responses (for debugging)'
		})
		.option('repo', {
			alias: 'r',
			type: 'string',
			array: true,
			description: 'GitHub repo(s) containing TPAC meeting-planning issues. By default, the same label will be applied to all repo searches. If you want to use different labels for some repos, you can specify the label to use after the repo shortname/URL.'
		})
		.option('save-result', {
			alias: 'S',
			type: 'string',
			description: 'Path to local JSON file to save all issues returned from all GitHub API query responses (for debugging)'
		})
		.option('style', {
			alias: 's',
			type: 'string',
			description: 'Name of CSS file you provide to style the HTML output',
			default: 'style.css'
		})
		.conflicts('query-result', 'save-result')
		.strict()
		.check(args => {
			if (!args.alternatives) args.alternatives = []
			return true
		})
		.parseSync()
}

function outputInvalidMeetings(ims: Partial<Meeting>[], equivalents: CombinedNames): string {
	if (ims.length === 0) return ''
	let html = ''

	console.log('// Invalid meeting issue entries')
	console.log()
	ims.forEach(p => {
		displayPartial(p, equivalents)
		html += htmlForPartialMeeting(p, equivalents)
		console.log()
	})

	console.log()
	return html
}

function htmlDayMeetingLinks(dms: DayMeetings, equivalents: CombinedNames): string {
	let html = '<ul>'
	Object.entries(dms).forEach(([day, meetings]) => {
		html += `<li>${pretty(day)}<ul>`
		for (const meeting of meetings) {
			html += listItemFor(meeting, false, equivalents)
		}
		html += `</ul></i>`
	})
	html += '</ul>'
	return html
}

function outputPlannedMeetings(pms: Meeting[], equivalents: CombinedNames, showDay: boolean): string {
	console.log('// Planned meetings')
	console.log()
	let html = ''
	let currentDay: Day | null = null

	for (const meeting of pms) {
		if (showDay && meeting.calendarDay !== currentDay) {
			currentDay = meeting.calendarDay
			console.log(pretty(meeting.calendarDay))
			html += `<h3>${pretty(meeting.calendarDay)}</h3>`
		}
		display(meeting, equivalents)
		console.log()
		html += htmlForMeeting(meeting, equivalents)
	}

	console.log()
	return html
}

function main() {
	const args = getArgs()
	const equivalents: CombinedNames = new Map()

	// FIXME: Figure out TypeScript/yargs workaround, and DRY with the below
	if (!!args.combine) {
		if (args.combine.length === 2 && args.combine.every(value => typeof value === 'string')) {
			args.combine = [args.combine] as unknown as string[]
		}
		if (!args.combine!.every(value =>
			Array.isArray(value) && value.length === 2)) {
			errorOut("Every 'equivalent' option value must be a pair of two usernames to consider equal. The values specified were:", args.combine)
		}
		for (const [name, otherName] of args.combine!) {
			equivalents.set(name, otherName)
		}
	}

	const dom = new JSDOM(getSchedule(args.meetings))
	const doc = dom.window.document

	const issues: GhIssue[] = []

	if (!!args.queryResult) {
		console.log('Using existing query result.')
		issues.push(...JSON.parse(fs.readFileSync(args.queryResult, 'utf-8')) as unknown as GhIssue[])
	} else if (!!args.repo) {
		console.log('Querying repo(s)...')

		// FIXME: Figure out TypeScript/yargs workaround, and DRY with the above
		if (!!args.repo) {
			if (args.repo.length <= 2 && args.repo.every(value => typeof value === 'string')) {
				args.repo = [args.repo] as unknown as string[]
			}
			if (!args.repo!.every(value =>
				Array.isArray(value) && value.length > 0 && value.length < 3)) {
				errorOut("Every 'repo' option value must be either a GitHub repo, OR a GitHub repo and issue label to use when querying that repo. The values specified were:", args.repo)
			}
		}
		// NOTE: TypeScript doesn't seem to know it, but at this point we know that args.repo is an array of 1- or 2-value arrays.
		for (const repoLabel of args.repo!) {
			issues.push(...getIssues(repoLabel[0], repoLabel[1] ?? args.label))
		}
	}

	if (issues.length === 0) {
		console.error('No issues found')
		return
	}
	console.log()

	const meetings: Meeting[] = []
	const invalidMeetings: Partial<Meeting>[] = []
	const movedMeetings: Meeting[] = []
	const unassignedMeetings: Meeting[] = []

	for (const issue of issues) {
		const meeting = meetingFromIssue(doc, issue)
		if (isMeeting(meeting)) {
			if (meeting.match === Match.NOPE) {
				movedMeetings.push(meeting)
			} else {
				meetings.push(meeting)
			}
			if (meeting.names.length === 0) {
				unassignedMeetings.push(meeting)
			}
		} else {
			invalidMeetings.push(meeting)
		}
	}

	sort(meetings)
	sort(movedMeetings)
	sort(unassignedMeetings)

	const haveInvalidMeetings = invalidMeetings.length > 0
	const haveMeetings = meetings.length > 0

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

	const plannedLinks = htmlDayMeetingLinks(dayMeetings, equivalents)
	const planned = outputPlannedMeetings(meetings, equivalents, true)

	const peopleDefinitelyClashingMeetings: PersonClashingMeetings = new Map()
	const peopleNearlyClashingMeetings: PersonClashingMeetings = new Map()

	let haveDefinitelyClashing = false
	let haveNearlyClashing = false

	for (const [name, dayMeetings] of personDayMeetings) {
		for (const [day, meetings] of dayMeetings) {
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
						end: meeting.start
					})
				}
				if (Temporal.PlainDateTime.compare(meeting.end, endOfLastMeeting) > 0) {
					endOfLastMeeting = meeting.end
				}
			}

			if (Temporal.PlainDateTime.compare(endOfLastMeeting, workingDay.end) < 0) {
					personDayGaps.get(name)?.get(day)?.push({
						start: endOfLastMeeting,
						end: workingDay.end
					})
			}
		}
	}

	for (const meeting of meetings) {
		meeting.alternatives.push(...alternatives(args.alternatives!, personDayGaps, meeting))
	}

	const repoPossibleDuplicates: RepoDuplicateMeetings = new Map()
	for (const [repo, meetings] of repoMeetings) {
		const grouped = Object.groupBy(meetings, meeting => meeting.calendarUrl)
		const possibleDupes = Object.values(grouped).filter(group => group && group.length > 1)
		if (possibleDupes.length > 0) {
			// TODO: the handling of undefined as a possibility seems a bit kludgy here
			repoPossibleDuplicates.set(repo, possibleDupes.filter(v => !!v))
		}
	}

	const haveMoved = movedMeetings.length > 0
	const havePossibleDuplicates = repoPossibleDuplicates.size > 0
	const haveUnassigned = unassignedMeetings.length > 0

	const invalidId = 'invalid'
	const invalidHeading = 'Invalid meeting entries'

	const possibleDuplicatesId = 'possible-duplicates'
	const possibleDuplicatesHeading = 'Possible duplicate meetings'

	const movedId = 'moved-meetings'
	const movedHeading = 'Moved meetings'

	const clashingId = 'clashing'
	const clashingHeading = 'Clashing meetings'

	const nearlyClashingId = 'nearly-clashing'
	const nearlyClashingHeading = 'Nearly clashing meetings'

	const unassignedId = 'unassigned'
	const unassignedHeading = 'Meetings without assignees'

	const plannedId = 'planned'
	const plannedHeading = 'Planned meetings'

	const timetableId = 'timetable'
	const timetableHeading = 'Timetable'

	const htmlStart = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>${myName}</title>
			<meta name="color-scheme" content="dark light" />
			<link rel="stylesheet" href="${args.style}">
			${peopleSelectorStyle(personDayMeetings)}
		</head>
		<body>
			<header>
				<h1>${myName}</h1>
			</header>
			<nav>
				<h2>Navigation and filtering</h2>
				${peopleSelector(personDayMeetings)}
				<ul>
					<li><p>${sectionLink(haveInvalidMeetings, invalidId, invalidHeading)}</p></li>
					<li><p>${sectionLink(haveMoved, movedId, movedHeading)}</p></li>
					<li><p>${sectionLink(havePossibleDuplicates, possibleDuplicatesId, possibleDuplicatesHeading)}</p></li>
					<li><p>${sectionLink(haveDefinitelyClashing, clashingId, clashingHeading)}</p></li>
					<li><p>${sectionLink(haveNearlyClashing, nearlyClashingId, nearlyClashingHeading)}</p></li>
					<li><p>${sectionLink(haveUnassigned, unassignedId, unassignedHeading)}</p></li>
					<li><p>${sectionLink(haveMeetings, plannedId, plannedHeading)}</p></li>
					<li><p>${sectionLink(true, timetableId, timetableHeading)}</p></li>
				</ul>
			</nav>
			<main>`
	const htmlEnd = '</main></body></html>'

	const html = htmlStart +
		(haveInvalidMeetings
			? `<h2 id="${invalidId}">${invalidHeading}</h2>` +
				'<p>A meeting would be flagged as invalid if it was cancelled, and thus deleted from the schedule page.</p>' +
				outputInvalidMeetings(invalidMeetings, equivalents)
			: '') +
		(haveMoved
			? `<h2 id="${movedId}">${movedHeading}</h2>` +
				outputPlannedMeetings(movedMeetings, equivalents, false)
			: '') +
		(havePossibleDuplicates
			? `<h2 id="${possibleDuplicatesId}">${possibleDuplicatesHeading}</h2>` +
				'<p>If there are multiple tracking issues in the same repo that refer to the same Calendar meeting, they may be duplicates (they may also be referring to separate parts of the same, longer, meeting).</p>' +
				'<p>Tracking issues in <em>different</em> repos that refer to the same Calendar entry are not automatically considerd possible duplicates.</p>' +
				outputPossibleDuplicateMeetings(repoPossibleDuplicates, equivalents)
			: '') +
		(haveDefinitelyClashing
			? `<h2 id="${clashingId}">${clashingHeading}</h2>` +
				outputClashingMeetings(peopleDefinitelyClashingMeetings, 'Definitely', equivalents)
			: '') +
		(haveNearlyClashing
			? `<h2 id="${nearlyClashingId}">${nearlyClashingHeading}</h2>` +
				outputClashingMeetings(peopleNearlyClashingMeetings, 'Nearly', equivalents)
			: '') +
		(haveUnassigned
			? `<h2 id="${unassignedId}">${unassignedHeading}</h2>` +
				outputUnassignedMeetings(unassignedMeetings, equivalents)
			: '') +
		(haveMeetings
			? `<h2 id="${plannedId}">${plannedHeading}</h2>` +
				'<h3>Summary</h3>' +
				plannedLinks +
				planned
			: '') +
		(true
			? `<h2 id="${timetableId}">${timetableHeading}</h2>` +
				outputTimetable(personDayMeetings, personDayGaps, equivalents)
			: '') +
		htmlEnd

	fs.writeFileSync(args.output, html)
	console.log('Written', args.output)
	if (!!args.saveResult) {
		fs.writeFileSync(args.saveResult, JSON.stringify(issues, null, 2))
		console.log('Written', args.saveResult)
	}
}

main()
