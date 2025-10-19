#!/usr/bin/env node
import fs from 'fs'
import { spawnSync } from 'child_process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { JSDOM } from 'jsdom'
import { Temporal } from '@js-temporal/polyfill'

const SCHEDULE_URL = 'https://www.w3.org/2025/11/TPAC/schedule.html'

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

type ConfigEntry = {
	repo: string
	label: string
}

type Config = ConfigEntry[]

let meetingCounter = 1

function objPushValue(obj: Object, key: string, thing: Object) {
	if (!Array.isArray(obj[key])) {
		obj[key] = [thing]
	} else {
		obj[key].push(thing)
	}
}

function objAddValue(obj: Object, key: string, thing: Object) {
	if (!(obj[key] instanceof Set)) {
		obj[key] = new Set([thing])
	} else {
		obj[key].add(thing)
	}
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
	const process = 'gh'
	const args = ['--repo', repo, 'issue', 'list', '--label', label, '--json', 'assignees,body,title,url']
	console.log(process, args.join(' '))
	const child = spawnSync(process, args)
	if (child.error) {
		throw (child.stderr)
	}
	return JSON.parse(child.stdout.toString())
}

function extractBodyInfo(body: String): Partial<GhBodyInfo> {
	// GitHub API line-ending weirdness: https://github.com/actions/runner/issues/1462#issuecomment-2676329157
	const bodyLines = body.split(/\r?\n/)

	const calendarUrl = bodyLines.shift()
	const rawDay = bodyLines.shift()?.toLowerCase()
	const day = isDay(rawDay) ? rawDay : undefined
	const startOfDay = day ? startOfDayFromString(day) ?? undefined : undefined
	const time = bodyLines.shift()
	const startAndEnd = startOfDay ? time?.split(' - ').map(tstr => timeStringToPlainDateTime(startOfDay, tstr)) : []
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
	const names = issue.assignees.map(assignee => assignee.name)
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

function display(meeting: Meeting) {
	const match = timeMatch(meeting)

	console.log('      tag:', meeting.tag)
	console.log(`Cal title: ${meeting.calendarTitle}`)

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

	console.log('   People:', meeting.ourNames)
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.ourIssueUrl)
	console.log('    Match:', timeMatch(meeting))
}

function displayPartial(meeting: Partial<Meeting>) {
	console.log('      tag:', meeting.tag)
	console.log(`Cal title: ${meeting.calendarTitle}`)

	console.log('  Cal day:', meeting.calendarDay ? pretty(meeting.calendarDay) : null)
	console.log('  Our day:', meeting.ourDay ? pretty(meeting.ourDay) : null)

	console.log(' Cal time:', meeting.calendarStart ? dtf(meeting.calendarStart) : '??', '-', meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??')
	console.log(' Our time:', meeting.ourStart ? dtf(meeting.ourStart) : '??', '-', meeting.ourEnd ? dtf(meeting.ourEnd) : '??')

	console.log('   People:', meeting.ourNames)
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.ourIssueUrl)
}

function htmlPeopleAndUrls(meeting: Partial<Meeting>): string {
	let out = ''
	out += `<dt>People</dt><dd>${meeting.ourNames}</dd>`
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

function listItemFor(meeting: Meeting, includeDay: boolean): string {
	const maybeDay = includeDay ? pretty(meeting.calendarDay) + ' ' : ''
	return `<li><p><a href="#${meeting.tag}">${meeting.calendarTitle}</a>, <b>${maybeDay}${dtf(meeting.ourStart)}&ndash;${dtf(meeting.ourEnd)}</b>, <i>${meeting.ourNames.join(', ')}</i></p></li>`
}

function htmlForMeeting(meeting: Meeting): string {
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

	out += htmlPeopleAndUrls(meeting)
	out += `<dt>Time match</dt><dd>${timeMatch(meeting)}</dd>`
	out += '</dl>'

	out += htmlNotes(meeting)

	out += '</div>'

	return `<div id="${meeting.tag}" class="meeting ${condition}"><h4>${meeting.calendarTitle}</h4><p><i>${meeting.ourTitle}</i></p><dl>` + out

}

function htmlForPartialMeeting(meeting: Partial<Meeting>): string {
	let out = `<div id="${meeting.tag}" class="meeting invalid"><h3>${meeting.calendarTitle}</h3><p><i>${meeting.ourTitle}</i></p><dl>`

	out += `<dt>Calendar day</dt><dd>${meeting.calendarDay ? pretty(meeting.calendarDay) : '???'}</dd>`
	out += `<dt>Our day</dt><dd>${meeting.ourDay ? pretty(meeting.ourDay) : '???'}</dd>`

	out += `<dt>Calendar time</dt><dd>${meeting.calendarStart ? dtf(meeting.calendarStart) : '??'}&ndash;${meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??'}</dd>`
	out += `<dt>Our time</dt><dd>${meeting.ourStart ? dtf(meeting.ourStart) : '??'}&ndash;${meeting.ourEnd ? dtf(meeting.ourEnd) : '??'}</dd>`

	out += htmlPeopleAndUrls(meeting)

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
	const day = parentSection?.id
	const start = link?.children[4].children[0].textContent
	const end = link?.children[4].children[1].textContent

	return { title, day, start, end }
}

function outputClashingMeetings(peopleClashingMettings: Record<string, Set<Meeting>>, kind: string): string {
	let html = ''
	for (const name in peopleClashingMettings) {
		console.log(`// ${kind} clashing meetings for ${name}`)
		console.log()
		if (peopleClashingMettings[name].size) {
			html += `<h3>${kind} clashing meetings for ${name}</h3><ul>`
			for (const meeting of peopleClashingMettings[name]) {
				display(meeting)
				html += listItemFor(meeting, true)
				console.log()
			}
			html += '</ul>'
			console.log()
			console.log()
		}
	}
	return html
}

function getArgs() {
	return yargs(hideBin(process.argv))
		.usage('TPAC scheduling helper\n\nUsage: $0 [options]')
		.option('config', {
			alias: 'c',
			type: 'string',
			description: 'Path to JSON config file, of the form: [ { repo, label }, ... ]'
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
			description: "Path to local meetings schedule file - it will be downloaded if it doesn't exist",
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
			description: 'Path to local JSON file that contains a GitHub API query response (for debugging)',
		})
		.option('repo', {
			alias: 'r',
			type: 'string',
			array: true,
			description: 'GitHub URL(s) of repo(s) containing TPAC meeting-planning issues (the same label will be applied to all repo searches - if you want to use different labels for different repos, you will need to make a config file)',
		})
		.option('style', {
			alias: 's',
			type: 'string',
			description: 'Name of CSS file you provide to style the HTML output',
			default: 'style.css'
		})
		.check(argv => {
			if (!!argv.repo && !!argv.queryResult && !!argv.config) {
				throw("One of 'repo', 'query-result', or 'config' must be provided.")
			}
			return true
		})
		.parseSync()
}

function isConfig(c: any): c is Config {
	if (!Array.isArray(c)) return false
	if (c.every(m => typeof m === 'object' && typeof m.repo === 'string' && typeof m.label === 'string')) {
		return true
	}
	return false
}

function outputInvalidMeetings(ims: Partial<Meeting>[]): string {
	if (ims.length === 0) return ''
	let html = ''

	console.log('// Invalid meeting issue entries')
	console.log()
	html += '<h2>Invalid meeting issue entries</h2>'
	ims.forEach(p => {
		displayPartial(p)
		html += htmlForPartialMeeting(p)
		console.log()
	})

	console.log()
	console.log()
	return html
}

function htmlDayMeetingLinks(dms: Map<Day, Meeting[]>): string {
	let html = '<ul>'
	dms.forEach((meetings, day) => {
		html += `<li>${pretty(day)}<ul>`
		for (const meeting of meetings) {
			html += listItemFor(meeting, false)
		}
		html += `</ul></li>`
	})
	html += '</ul>'
	return html
}

function outputPlannedMeetings(pms: Meeting[]): string {
	console.log('// Planned meetings')
	console.log()
	let html = '' // NOTE: This heading is done elsewhere, due to the meeting summary
	let currentDay: Day | null = null

	for (const meeting of pms) {
		if (meeting.calendarDay !== currentDay) {
			currentDay = meeting.calendarDay
			console.log(pretty(meeting.calendarDay))
			html += `<h3>${pretty(meeting.calendarDay)}</h3>`
		}
		display(meeting)
		console.log()
		html += htmlForMeeting(meeting)
	}

	console.log()
	console.log()
	return html
}

function main() {
	const args = getArgs()

	const dom = new JSDOM(getSchedule(args.meetings))
	const doc = dom.window.document

	const issues: GhIssue[] = []

	if (!!args.repo) {
		console.log('Querying repo(s)...')
		for (const repo of args.repo) {
			issues.push(...getIssues(repo, args.label))
		}
	} else if (!!args.queryResult) {
		console.log('Using existing query result')
		issues.push(...JSON.parse(fs.readFileSync(args.queryResult, 'utf-8')) as unknown as GhIssue[])
	} else if (!!args.config) {
		console.log('Querying repo(s) based on config file...')
		const config = JSON.parse(fs.readFileSync(args.config, 'utf-8'))
		if (isConfig(config)) {
			for (const { repo, label } of config) {
				issues.push(...getIssues(repo, label))
			}
		} else {
			console.error(`Invalid config file. It should be JSON of the form:

[
	{
		"repo": "<org/name or full URL>",
		"label": "<label used for TPAC planning issues in this repo>"
	},
	. . .
]`)
			return
		}
	}

	if (issues.length === 0) {
		console.error('No issues found')
		return
	}

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

	const dayMeetings = new Map<Day, Meeting[]>
	const peopleMeetings: Record<string, Meeting[]> = {}

	for (const meeting of meetings) {
		for (const name of meeting.ourNames) {
			objPushValue(peopleMeetings, name, meeting)
			mapPushValue(dayMeetings, meeting.calendarDay, meeting)
		}
	}

	const peopleDefinitelyClashingMeetings: Record<string, Set<Meeting>> = {}
	const peopleNearlyClashingMeetings: Record<string, Set<Meeting>> = {}

	for (const name in peopleMeetings) {
		for (const meeting of peopleMeetings[name]) {
			for (const other of peopleMeetings[name]) {
				if (meeting === other) continue
				switch (clashes(meeting, other)) {
					case Clash.DEFO:
						objAddValue(peopleDefinitelyClashingMeetings, name, meeting)
						break
					case Clash.NEAR:
						objAddValue(peopleNearlyClashingMeetings, name, meeting)
						break
				}
			}
		}
	}

	const htmlStart = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>TPAC Schedule Helper</title>
			<meta name="color-scheme" content="dark light" />
			<link rel="stylesheet" href="${args.style}">
		</head>
		<body>
			<h1>TPAC Schedule Helper</h1>
			<ul>
				<li><p><a href="#planned">Planned meetings</a></p></li>
				<li><p><a href="#clashing">Definitely clashing meetings</a></p></li>
				<li><p><a href="#near">Nearly clashing meetings</a></p></li>
			</ul>`
	const invalidOutput = outputInvalidMeetings(invalidMeetings)
	const plannedLinks = htmlDayMeetingLinks(dayMeetings)
	const planned = outputPlannedMeetings(meetings)
	const clashing = outputClashingMeetings(peopleDefinitelyClashingMeetings, 'Definitely')
	const nearlyClashing = outputClashingMeetings(peopleNearlyClashingMeetings, 'Nearly')
	const htmlEnd = '</body></html>'

	const html = htmlStart +
		invalidOutput +
		'<h2 id="planned">Planned meetings</h2>' +
		'<h3>Summary</h3>' +
		plannedLinks +
		planned +
		'<h2 id="clashing">Definitely clashing meetings</h2>' +
		clashing +
		'<h2 id="near">Nearly clashing meetings</h2>' +
		nearlyClashing +
		htmlEnd

	fs.writeFileSync(args.output, html)
	console.log('Written', args.output)
}

main()
