#!/usr/bin/env node
import * as fs from 'fs'
import { spawnSync } from 'child_process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { JSDOM } from 'jsdom'
import { Temporal } from '@js-temporal/polyfill'

const SCHEDULE_URL = 'https://www.w3.org/2025/11/TPAC/schedule.html'

type CombinedNames = Record<string, string>
type DayMeetings = Map<Day, Meeting[]>
type PeopleMeetings = Record<string, Meeting[]>
type RepoMeetings = Record<string, Meeting[]>
type RepoDuplicateMeetings = Record<string, Meeting[][]>
type PeopleClashingMeetings = Record<string, ClashingMeetingSet>

const Days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const
type Day = typeof Days

const Match = {
	'EXACT': 'Exact',
	'SUBSET': 'Subset',
	'NOPE': 'Nope'
} as const
type MatchStatus = typeof Match[keyof typeof Match]

const Clash = {
	'NONE': 'No clash',
	'DEFO': 'CLASHES!',
	'NEAR': 'Mind Gap'
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
	notes?: string
}

type CalendarMeetingInfo = {
	title: string
	day: Day
	start: string
	end: string
}

type Meeting = {
	tag: number
	calendarTitle: string
	ourTitle: string
	calendarDay: Day
	ourDay: Day
	calendarStart: Temporal.PlainDateTime
	ourStart: Temporal.PlainDateTime
	calendarEnd: Temporal.PlainDateTime
	ourEnd: Temporal.PlainDateTime
	ourNames: string[]
	calendarUrl: string
	ourIssueUrl: string
	notes?: string
}

const myName = 'TPAC scheduling helper'
let meetingCounter = 1

class ClashingMeetingSet {
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
			// TODO: Had to call it like this to satisfy ts - could be neater?
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

function errorOut(...args: any) {
	console.error(...args)
	process.exit(42)
}

function sameActualMeeting(meeting: Meeting, other: Meeting) {
	return meeting.calendarUrl === other.calendarUrl &&
		meeting.ourStart.equals(other.ourStart) &&
		meeting.ourEnd.equals(other.ourEnd)
}

function people(names: string[], combined: CombinedNames): string {
	return names.map(name => name in combined
		? combined[name] + ' (' + name + ')'
		: name).join(', ')
}

function repo(issueUrl: string): string {
	return issueUrl.slice(19).split('/').slice(0, -2).join('/')
}

function peopleSelector(pms: PeopleMeetings): string {
	if (Object.keys(pms).length === 0) return ''
	let html = '<label>Show clashing meetings for <select><option selected>everyone</option>'
	Object.keys(pms).forEach(name => html += `<option value="${name}">${name}</option>`)
	return html + '</select></label>'
}

function peopleSelectorStyle(pms: PeopleMeetings): string {
	let html = `<style>
		section[data-person] {
			display: none;
		}

		body:has(select > option:not([value]):checked) section[data-person] {
			display: block;
		}`

	for (const person of Object.keys(pms)) {
		html += `body:has(select > option[value="${person}"]:checked) section[data-person="${person}"] {
			display: block;
		}`
	}

	return html + '</style>'
}

function sectionLink(flag: boolean, idref: string, pretty: string) {
	return flag
		? `<a href="#${idref}">${pretty}</a>`
		: `${pretty} (none)`
}

function objPushValue(obj: Object, key: string, thing: Object) {
	if (!Array.isArray(obj[key])) {
		obj[key] = [thing]
	} else {
		obj[key].push(thing)
	}
}

function objAddClash(obj: Object, key: string, a: Meeting, b: Meeting) {
	if (!(obj[key] instanceof ClashingMeetingSet)) {
		obj[key] = new ClashingMeetingSet()
	}
	obj[key].add(a, b)
}

function mapPushValue(map: Map<Day, Meeting[]>, key: Day, thing: Meeting) {
	if (!Array.isArray(map.get(key))) {
		map.set(key, [thing])
	} else {
		map.get(key)?.push(thing)
	}
}

function dtf(pdt: Temporal.PlainDateTime): string {
	return pdt.toLocaleString(undefined, {
		hour: '2-digit',
		minute: '2-digit'
	})
}

function isDay(candidate: any): candidate is Day {
	return Days.indexOf(candidate) > -1
}

function pretty(day: Day): string {
	return (day as unknown as string).charAt(0).toUpperCase() + day.slice(1)
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
		errorOut('Error parsing GitHub API result:', err.message ?? err)
	}
	return []  // NOTE: Here for TypeScript
}

function extractBodyInfo(body: String): Partial<GhBodyInfo> {
	// GitHub API line-ending weirdness: https://github.com/actions/runner/issues/1462#issuecomment-2676329157
	const bodyLines = body.split(/\r?\n/)

	const calendarUrl = bodyLines.shift()
	const rawDay = bodyLines.shift()?.toLowerCase()
	const day = isDay(rawDay) ? rawDay : undefined
	const startOfDay = day ? startOfDayFromString(day) ?? undefined : undefined
	const time = bodyLines.shift()
	const startAndEnd = startOfDay ? time?.split(/ ?[–-] ?/).map(tstr => timeStringToPlainDateTime(startOfDay, tstr)) : []
	const start = startAndEnd?.[0]
	const end = startAndEnd?.[1]
	bodyLines.shift()  // TODO make an error condition for this if not present?

	return { calendarUrl, day, startOfDay, start, end, notes: bodyLines.join('\n') }
}

function isMeeting(p: Partial<Meeting>): p is Meeting {
	return !!p.tag &&
		!!p.calendarTitle &&
		!!p.ourTitle &&
		!!p.calendarDay &&
		!!p.ourDay &&
		!!p.calendarStart &&
		!!p.ourStart &&
		!!p.calendarEnd &&
		!!p.ourEnd &&
		!!p.ourNames &&
		!!p.calendarUrl &&
		!!p.ourIssueUrl
}

function meetingFromIssue(doc: Document, issue: GhIssue): Meeting | Partial<Meeting> {
	const bodyInfo = extractBodyInfo(issue.body)
	const names = issue.assignees.map(assignee => assignee.login)
	const calendarInfo = calendarMeetingInfo(doc, bodyInfo.calendarUrl ?? '')

	return {
		tag: meetingCounter++,
		calendarTitle: calendarInfo?.title,
		ourTitle: issue.title,
		calendarDay: calendarInfo?.day,
		ourDay: bodyInfo.day,
		calendarStart: (bodyInfo.startOfDay && calendarInfo.start) ?
			timeStringToPlainDateTime(bodyInfo.startOfDay, calendarInfo.start) : undefined,
		ourStart: bodyInfo.start,
		calendarEnd: (bodyInfo.startOfDay && calendarInfo.end) ?
			timeStringToPlainDateTime(bodyInfo.startOfDay, calendarInfo.end) : undefined,
		ourEnd: bodyInfo.end,
		ourNames: names,
		calendarUrl: bodyInfo.calendarUrl,
		ourIssueUrl: issue.url,
		notes: bodyInfo.notes
	}
}

function timeMatch(m: Meeting): MatchStatus {
	const start = Temporal.PlainDateTime.compare(m.calendarStart, m.ourStart)
	const end = Temporal.PlainDateTime.compare(m.calendarEnd, m.ourEnd)

	if (start === 0 && end === 0) return Match.EXACT
	if (start <= 0 && end >= 0) return Match.SUBSET
	return Match.NOPE
}

function clashes(m: Meeting, o: Meeting): ClashStatus {
	const gap = Temporal.Duration.from({ minutes: 10 })

	if (Temporal.PlainDateTime.compare(m.ourStart, o.ourStart) >= 0
	 && Temporal.PlainDateTime.compare(m.ourStart, o.ourEnd)   <= 0) return Clash.DEFO

	if (Temporal.PlainDateTime.compare(m.ourEnd,   o.ourStart) >= 0
	 && Temporal.PlainDateTime.compare(m.ourEnd,   o.ourEnd)   <= 0) return Clash.DEFO

	if (Temporal.PlainDateTime.compare(m.ourStart, o.ourStart.subtract(gap)) >= 0
	 && Temporal.PlainDateTime.compare(m.ourStart, o.ourEnd.add(gap))        <= 0) return Clash.NEAR

	if (Temporal.PlainDateTime.compare(m.ourEnd,   o.ourStart.subtract(gap)) >= 0
	 && Temporal.PlainDateTime.compare(m.ourEnd,   o.ourEnd.add(gap))        <= 0) return Clash.NEAR

	return Clash.NONE
}

function display(meeting: Meeting, combined: CombinedNames) {
	const match = timeMatch(meeting)

	console.log('      tag:', meeting.tag)
	console.log(`Cal title: ${meeting.calendarTitle}`)
	console.log(`Our title: ${meeting.ourTitle}`)
	console.log('     Repo:', repo(meeting.ourIssueUrl))

	if (match === Match.NOPE) {
		console.log('  Cal day:', pretty(meeting.calendarDay))
		console.log('  Our day:', pretty(meeting.ourDay))
	} else {
		console.log('      Day:', pretty(meeting.ourDay))
	}

	if (match !== Match.EXACT) {
		console.log(' Cal time:', dtf(meeting.calendarStart), '-', dtf(meeting.calendarEnd))
		console.log(' Our time:', dtf(meeting.ourStart), '-', dtf(meeting.ourEnd))
	} else {
		console.log('     Time:', dtf(meeting.ourStart), '-', dtf(meeting.ourEnd))
	}

	console.log('   People:', people(meeting.ourNames, combined))
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.ourIssueUrl)
	console.log('    Match:', timeMatch(meeting))
}

function displayPartial(meeting: Partial<Meeting>, combined: CombinedNames) {
	console.log('      tag:', meeting.tag)
	console.log(`Cal title: ${meeting.calendarTitle}`)
	console.log(`Our title: ${meeting.ourTitle}`)
	console.log('     Repo:', meeting.ourIssueUrl ? repo(meeting.ourIssueUrl) : null)

	console.log('  Cal day:', meeting.calendarDay ? pretty(meeting.calendarDay) : null)
	console.log('  Our day:', meeting.ourDay ? pretty(meeting.ourDay) : null)

	console.log(' Cal time:', meeting.calendarStart ? dtf(meeting.calendarStart) : '??', '-', meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??')
	console.log(' Our time:', meeting.ourStart ? dtf(meeting.ourStart) : '??', '-', meeting.ourEnd ? dtf(meeting.ourEnd) : '??')

	console.log('   People:', meeting.ourNames ? people(meeting.ourNames, combined) : null)
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.ourIssueUrl)
}

function htmlPeopleAndUrls(meeting: Partial<Meeting>, combined: CombinedNames): string {
	let out = ''
	out += `<dt>People</dt><dd>${meeting.ourNames ? people(meeting.ourNames, combined) : null}</dd>`
	out += `<dt>Calendar URL</dt><dd><a href="${meeting.calendarUrl}">${meeting.calendarUrl}</a></dd>`
	out += `<dt>Our issue URL</dt><dd><a href="${meeting.ourIssueUrl}">${meeting.ourIssueUrl}</a></dd>`
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

function listItemFor(meeting: Meeting, includeDay: boolean, combined: CombinedNames): string {
	return `<li><p>${oneLinerFor(meeting, includeDay,combined)}</p></li>`
}

function oneLinerFor(meeting: Meeting, includeDay: boolean, combned: CombinedNames, skipName?: string): string {
	const maybeDay = includeDay ? pretty(meeting.calendarDay) + ' ' : ''
	const names = skipName
		? meeting.ourNames.filter(name => name !== skipName)
		: meeting.ourNames
	const nameHtml = names.length
		? `, <i>${people(names, combned)}</i>`
		: ''
	return `<a href="#${meeting.tag}">${meeting.calendarTitle}</a>, <b>${maybeDay}${dtf(meeting.ourStart)}&ndash;${dtf(meeting.ourEnd)}</b>${nameHtml}`
}

function htmlMeetingHeader(meeting: Partial<Meeting>, condition: string): string {
	return `<div id="${meeting.tag}" class="meeting ${condition}">
		<h4>${meeting.calendarTitle}</h4>
		<p><i>${meeting.ourTitle}</i> <span>from: ${meeting.ourIssueUrl ? repo(meeting.ourIssueUrl) : null}</span></p>
		<dl>`
}

function htmlForMeeting(meeting: Meeting, combined: CombinedNames): string {
	const match = timeMatch(meeting)

	let out = ''
	let condition = 'exact'

	if (match === Match.NOPE) {
		condition = 'nope'
		out += `<dt>Calendar day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
		out += `<dt>Our day</dt><dd>${pretty(meeting.ourDay)}</dd>`
	} else {
		out += `<dt>Day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
	}

	if (match !== Match.EXACT) {
		condition = 'subset'
		out += `<dt>Calendar time</dt><dd>${dtf(meeting.calendarStart)}&ndash;${dtf(meeting.calendarEnd)}</dd>`
		out += `<dt>Our time</dt><dd>${dtf(meeting.ourStart)}&ndash;${dtf(meeting.ourEnd)}</dd>`
	} else {
		out += `<dt>Time</dt><dd>${dtf(meeting.ourStart)}&ndash;${dtf(meeting.ourEnd)}</dd>`
	}

	out += htmlPeopleAndUrls(meeting, combined)
	out += `<dt>Time match</dt><dd>${timeMatch(meeting)}</dd>`
	out += '</dl>'

	out += htmlNotes(meeting)

	out += '</div>'

	// TODO: Make the mapping of condition to string more type-y?
	return htmlMeetingHeader(meeting, condition) + out
}

function htmlForPartialMeeting(meeting: Partial<Meeting>, combined: CombinedNames): string {
	let out = htmlMeetingHeader(meeting, 'invalid')

	out += `<dt>Calendar day</dt><dd>${meeting.calendarDay ? pretty(meeting.calendarDay) : '???'}</dd>`
	out += `<dt>Our day</dt><dd>${meeting.ourDay ? pretty(meeting.ourDay) : '???'}</dd>`

	out += `<dt>Calendar time</dt><dd>${meeting.calendarStart ? dtf(meeting.calendarStart) : '??'}&ndash;${meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??'}</dd>`
	out += `<dt>Our time</dt><dd>${meeting.ourStart ? dtf(meeting.ourStart) : '??'}&ndash;${meeting.ourEnd ? dtf(meeting.ourEnd) : '??'}</dd>`

	out += htmlPeopleAndUrls(meeting, combined)

	out += '</dl>'
	out += htmlNotes(meeting)

	out += '</div>'

	return out
}

function startOfDayFromString(candidate: String): Temporal.PlainDateTime | null {
	switch (candidate.toLowerCase()) {
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
	return null
}

function calendarMeetingInfo(doc: Document, url: String): Partial<CalendarMeetingInfo> {
	const link = doc.querySelector(`a[href="${url}"]`)
	const parentSection = (link?.parentElement?.parentElement?.parentElement)

	const title = link?.firstElementChild?.textContent
	const rawDay = parentSection?.id
	const start = link?.children[4].children[0].textContent
	const end = link?.children[4].children[1].textContent

	return { title, day: isDay(rawDay) ? rawDay : undefined, start, end }
}

function outputClashingMeetings(peopleClashingMeetings: PeopleClashingMeetings, kind: string, combined: CombinedNames): string {
	let html = ''
	for (const name in peopleClashingMeetings) {
		console.log(`// ${kind} clashing meetings for ${name}`)
		console.log()
		if (peopleClashingMeetings[name].size) {
			html += `<section data-person="${name}">`
			html += `<h3>${kind} clashing meetings for ${name}</h3><ul>`
			for (const [m, o] of peopleClashingMeetings[name]) {
				display(m, combined)
				console.log('...and...')
				display(o, combined)
				html += `<li><p>${oneLinerFor(m, true, combined, name)}<br>and<br>${oneLinerFor(o, true, combined, name)}</p></li>`
				console.log()
			}
			html += '</ul>'
			html += '</section>'
			console.log()
			console.log()
		}
	}
	return html
}

function outputPossibleDuplicateMeetings(pdm: RepoDuplicateMeetings, combined: CombinedNames): string {
	let html = ''
	for (const repo in pdm) {
		console.log(`// Possible duplicate meetings in ${repo}`)
		console.log()
		html += `<h3>Possibly duplicate meetings in ${repo}</h3>`
		for (const [index, meetings] of pdm[repo].entries()) {
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
		console.log()
	}
	return html
}

function getArgs() {
	return yargs(hideBin(process.argv)).parserConfiguration({
		'flatten-duplicate-arrays': false
	})
		.usage(myName + '\n\nUsage: $0 [options]')
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
	console.log()
	return html
}

function htmlDayMeetingLinks(dms: Map<Day, Meeting[]>, equivalents: CombinedNames): string {
	let html = '<ul>'
	dms.forEach((meetings, day) => {
		html += `<li>${pretty(day)}<ul>`
		for (const meeting of meetings) {
			html += listItemFor(meeting, false, equivalents)
		}
		html += `</ul></i>`
	})
	html += '</ul>'
	return html
}

function outputPlannedMeetings(pms: Meeting[], equivalents: CombinedNames): string {
	console.log('// Planned meetings')
	console.log()
	let html = ''
	let currentDay: Day | null = null

	for (const meeting of pms) {
		if (meeting.calendarDay !== currentDay) {
			currentDay = meeting.calendarDay
			console.log(pretty(meeting.calendarDay))
			html += `<h3>${pretty(meeting.calendarDay)}</h3>`
		}
		display(meeting, equivalents)
		console.log()
		html += htmlForMeeting(meeting, equivalents)
	}

	console.log()
	console.log()
	return html
}

function main() {
	const args = getArgs()
	const equivalents: CombinedNames = {}

	// FIXME: Figure out TypeScript/yargs workaround, and DRY with the below
	if (!!args.combine) {
		if (args.combine.length === 2 && args.combine.every(value => typeof value === 'string')) {
			args.combine = [args.combine]
		}
		if (!args.combine!.every(value =>
			Array.isArray(value) && value.length === 2)) {
			errorOut("Every 'equivalent' option value must be a pair of two usernames to consider equal. The values specified were:", args.combine)
		}
		for (const [name, otherName] of args.combine!) {
			equivalents[name] = otherName
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
			if (args.repo.length == 2 && args.repo.every(value => typeof value === 'string')) {
				args.repo = [args.repo]
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

	for (const issue of issues) {
		const meeting = meetingFromIssue(doc, issue)
		if (isMeeting(meeting)) {
			meetings.push(meeting)
		} else {
			invalidMeetings.push(meeting)
		}
	}

	meetings.sort((a, b) => Temporal.PlainDateTime.compare(a.ourStart, b.ourStart))

	const haveInvalidMeetings = invalidMeetings.length > 0
	const haveMeetings = meetings.length > 0

	const dayMeetings: DayMeetings = new Map()
	const peopleMeetings: PeopleMeetings = {}
	const repoMeetings: RepoMeetings = {}

	for (const meeting of meetings) {
		for (const name of meeting.ourNames) {
			objPushValue(peopleMeetings, equivalents[name] ?? name, meeting)
		}
		mapPushValue(dayMeetings, meeting.calendarDay, meeting)
		objPushValue(repoMeetings, repo(meeting.ourIssueUrl), meeting)
	}

	// TODO: Find a neater way to groupBy across two properties than having the intermediate structure
	const repoPossibleDuplicates: Record<string, Meeting[][]> = {}
	for (const repo in repoMeetings) {
		const possibleDupes = Object.values(
			Object.groupBy(repoMeetings[repo], meeting => meeting.calendarUrl)
		).filter(group => group.length > 1)
		if (possibleDupes.length > 0) {
			repoPossibleDuplicates[repo] = possibleDupes
		}
	}

	const havePossibleDuplicates = Object.keys(repoPossibleDuplicates).length > 0

	const peopleDefinitelyClashingMeetings: PeopleClashingMeetings = {}
	const peopleNearlyClashingMeetings: PeopleClashingMeetings = {}

	let haveDefinitelyClashing = false
	let haveNearlyClashing = false

	for (const name in peopleMeetings) {
		for (const meeting of peopleMeetings[name]) {
			for (const other of peopleMeetings[name]) {
				if (meeting === other) continue

				// Cope with the case that the same meeting has been specified in multiple repos.
				if (sameActualMeeting(meeting, other)) continue

				switch (clashes(meeting, other)) {
					case Clash.DEFO:
						objAddClash(peopleDefinitelyClashingMeetings, name, meeting, other)
						haveDefinitelyClashing = true
						break
					case Clash.NEAR:
						objAddClash(peopleNearlyClashingMeetings, name, meeting, other)
						haveNearlyClashing = true
						break
				}
			}
		}
	}

	const plannedLinks = htmlDayMeetingLinks(dayMeetings, equivalents)
	const planned = outputPlannedMeetings(meetings, equivalents)

	const invalidId = 'invalid'
	const invalidHeading = 'Invalid meeting entries'

	const possibleDuplicatesId = 'possible-duplicates'
	const possibleDuplicatesHeading = 'Possible duplicate meetings'

	const plannedId = 'planned'
	const plannedHeading = 'Planned meetings'

	const clashingId = 'clashing'
	const clashingHeading = 'Clashing meetings'

	const nearlyClashingId = 'nearly-clashing'
	const nearlyClashingHeading = 'Nearly clashing meetings'

	const htmlStart = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>${myName}</title>
			<meta name="color-scheme" content="dark light" />
			<link rel="stylesheet" href="${args.style}">
			${peopleSelectorStyle(peopleMeetings)}
		</head>
		<body>
			<header>
				<h1>${myName}</h1>
			</header>
			<nav>
				<h2>Navigation and filtering</h2>
				${peopleSelector(peopleMeetings)}
				<ul>
					<li><p>${sectionLink(haveInvalidMeetings, invalidId, invalidHeading)}</p></li>
					<li><p>${sectionLink(havePossibleDuplicates, possibleDuplicatesId, possibleDuplicatesHeading)}</p></li>
					<li><p>${sectionLink(haveDefinitelyClashing, clashingId, clashingHeading)}</p></li>
					<li><p>${sectionLink(haveNearlyClashing, nearlyClashingId, nearlyClashingHeading)}</p></li>
					<li><p>${sectionLink(haveMeetings, plannedId, plannedHeading)}</p></li>
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
		(haveMeetings
			? `<h2 id="${plannedId}">${plannedHeading}</h2>` +
				'<h3>Summary</h3>' +
				plannedLinks +
				planned
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
