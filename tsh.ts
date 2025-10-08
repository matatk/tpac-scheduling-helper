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

let meetingCounter = 1

function dtf(pdt: Temporal.PlainDateTime): string {
	return pdt.toLocaleString(undefined, {
		hour: '2-digit',
		minute: '2-digit'
	})
}

function isDay(candidate: any): candidate is Day {
	return Days.indexOf(candidate) > -1
}

function prettyDay(day: Day): string {
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
	console.log('Querying GitHub...')
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
		console.log('  Cal day:', prettyDay(meeting.calendarDay))
		console.log('  Our day:', prettyDay(meeting.ourDay))
	} else {
		console.log('      Day:', prettyDay(meeting.ourDay))
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

	console.log('  Cal day:', meeting.calendarDay ? prettyDay(meeting.calendarDay) : null)
	console.log('  Our day:', meeting.ourDay ? prettyDay(meeting.ourDay) : null)

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

function htmlForMeeting(meeting: Meeting): string {
	const match = timeMatch(meeting)

	let out = `<div id="${meeting.tag}" class="meeting"><h3>${meeting.calendarTitle}</h3><p><i>${meeting.ourTitle}</i></p><dl>`

	if (match === Match.NOPE) {
		out += `<dt>Calendar day</dt><dd>${prettyDay(meeting.calendarDay)}</dd>`
		out += `<dt>Our day</dt><dd>${prettyDay(meeting.ourDay)}</dd>`
	} else {
		out += `<dt>Day</dt><dd>${prettyDay(meeting.calendarDay)}</dd>`
	}

	if (match !== Match.EXACT) {
		out += `<dt>Calendar time</dt><dd>${dtf(meeting.calendarStart)}&ndash;${dtf(meeting.calendarEnd)}</dd>`
		out += `<dt>Our time</dt><dd>${dtf(meeting.ourStart)}&ndash;${dtf(meeting.ourEnd)}</dd>`
	} else {
		out += `<dt>Time</dt><dd>${dtf(meeting.ourStart)}&ndash;${dtf(meeting.ourEnd)}</dd>`
	}

	out += htmlPeopleAndUrls(meeting)
	out += `<dt>Match</dt><dd>${timeMatch(meeting)}</dd>`
	out += '</dl>'

	out += htmlNotes(meeting)

	out += '</div>'

	return out
}

function htmlForPartialMeeting(meeting: Partial<Meeting>): string {
	let out = `<div id="${meeting.tag}" class="meeting invalid"><h3>${meeting.calendarTitle}</h3><p><i>${meeting.ourTitle}</i></p><dl>`

	out += `<dt>Calendar day</dt><dd>${meeting.calendarDay ? prettyDay(meeting.calendarDay) : '???'}</dd>`
	out += `<dt>Our day</dt><dd>${meeting.ourDay ? prettyDay(meeting.ourDay) : '???'}</dd>`

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
			html += `<h2>${kind} clashing meetings for ${name}</h2><ul>`
			for (const meeting of peopleClashingMettings[name]) {
				display(meeting)
				html += `<li><p><a href="#${meeting.tag}">${meeting.calendarTitle}</a>, ${prettyDay(meeting.calendarDay)}, ${dtf(meeting.ourStart)}&ndash;${dtf(meeting.ourEnd)}</p></li>`
				console.log()
			}
			html += '</ul>'
			console.log()
			console.log()
		}
	}
	return html
}

function getConfig() {
	return yargs(hideBin(process.argv))
		.usage('TPAC scheduling helper\n\nUsage: $0 [options]')
		.option('repo', {
			alias: 'r',
			type: 'string',
			description: 'GitHub URL of repo containing TPAC meeting-planning issues',
			required: true
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
		.option('json', {
			alias: 'j',
			type: 'string',
			description: 'Path to local JSON file that contains a GitHub API query response (for debugging)',
		})
		.option('output', {
			alias: 'o',
			type: 'string',
			description: 'Path to HTML file to create with info on all the meetings',
			required: true
		})
		.option('style', {
			alias: 's',
			type: 'string',
			description: 'Name of CSS file you provide to style the HTML output',
			default: 'style.css'
		})
		.parseSync()
}

function main() {
	const args = getConfig()

	const dom = new JSDOM(getSchedule(args.meetings))
	const doc = dom.window.document

	const issues = args.json
		? JSON.parse(fs.readFileSync(args.json, 'utf-8')) as unknown as GhIssue[]
		: getIssues(args.repo, args.label)

	if (issues.length === 0) {
		console.error('No issues found')
		return
	}

	let html = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>TPAC Schedule Helper</title>
			<meta name="color-scheme" content="dark light" />
			<link rel="stylesheet" href="${args.style}">
		</head>
		<body>
			<h1>TPAC Schedule Helper</h1>`

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

	if (invalidMeetings.length) {
		console.log('// Invalid meeting issue entries')
		console.log()
		html += '<h2>Invalid meeting issue entries</h2>'

		invalidMeetings.forEach(p => {
			displayPartial(p)
			html += htmlForPartialMeeting(p)
			console.log()
		})

		console.log()
		console.log()
	}

	meetings.sort((a, b) => Temporal.PlainDateTime.compare(a.ourStart, b.ourStart))

	const peopleMeetings: Record<string, Meeting[]> = {}

	console.log('// Planned meetings')
	console.log()
	html += '<h2>Planned meetings</h2>'
	for (const meeting of meetings) {
		display(meeting)
		console.log()
		html += htmlForMeeting(meeting)

		// TODO: List peopleMeetings on the console?
		for (const name of meeting.ourNames) {
			if (!Array.isArray(peopleMeetings[name])) {
				peopleMeetings[name] = [meeting]
			} else {
				peopleMeetings[name].push(meeting)
			}
		}
	}
	console.log()
	console.log()

	const peopleDefinitelyClashingMeetings: Record<string, Set<Meeting>> = {}
	const peopleNearlyClashingMeetings: Record<string, Set<Meeting>> = {}

	for (const name in peopleMeetings) {
		for (const meeting of peopleMeetings[name]) {
			for (const other of peopleMeetings[name]) {
				if (meeting === other) continue
				switch (clashes(meeting, other)) {
					case Clash.DEFO:
						if (!Array.isArray(peopleDefinitelyClashingMeetings[name])) {
							peopleDefinitelyClashingMeetings[name] = new Set([meeting, other])
						} else {
							peopleDefinitelyClashingMeetings[name].add(meeting)
							peopleDefinitelyClashingMeetings[name].add(other)
						}
						break
					case Clash.NEAR:
						if (!Array.isArray(peopleNearlyClashingMeetings[name])) {
							peopleNearlyClashingMeetings[name] = new Set([meeting, other])
						} else {
							peopleNearlyClashingMeetings[name].add(meeting)
							peopleNearlyClashingMeetings[name].add(other)
						}
						break
				}
			}
		}
	}

	html += outputClashingMeetings(peopleDefinitelyClashingMeetings, 'Definitely')
	html += outputClashingMeetings(peopleNearlyClashingMeetings, 'Nearly')

	html += '</body></html>'

	fs.writeFileSync(args.output, html)
	console.log('Written', args.output)
}

main()
