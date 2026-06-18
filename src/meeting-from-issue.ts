import { URL } from 'url'

import { Temporal } from '@js-temporal/polyfill'

import { isDay } from './day.ts'
import { timeMatch } from './meeting.ts'

import type { Day } from './day.ts'
import type { EventInfoGetter } from './schedule-info.ts'
import type { GhIssue } from './get-issues.ts'
import type { Meeting } from './meeting.ts'
import type { TpacDays } from './tpacs.ts'

export const _test = { parseBodyInfo }

// TODO: Do we need these to be PlainDateTimes?
interface ParsedGhBodyInfo {
	calendarUrl: string
	day: Day
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
	extraPeople: string[]  // Hack around 10-assignee limit
	notes?: string
}

let meetingCounter = 1

export default function meetingFromIssue(
	tpac: TpacDays,
	getter: EventInfoGetter,
	issue: GhIssue,
): Meeting | Partial<Meeting> {
	const bodyInfo = parseBodyInfo(tpac, issue.body)
	bodyInfo.extraPeople ??= []

	const names = issue.assignees.map(assignee => assignee.login)
	const uid = URL.parse(bodyInfo.calendarUrl?.replace(/\/$/, '') ?? '')?.pathname.split('/').at(-1)  // FIXME test
	const calendarInfo = getter(uid ?? '')

	const match = calendarInfo.kind !== 'nonexistent'
		? bodyInfo.start && bodyInfo.end
			? timeMatch(calendarInfo.calendarStart, calendarInfo.calendarEnd, bodyInfo.start, bodyInfo.end)
			: undefined
		: undefined

	return {
		...calendarInfo,
		alternatives: [], // NOTE: Only known after computing clashes and free times
		day: bodyInfo.day,
		end: bodyInfo.end,
		issueUrl: issue.url,
		kind: calendarInfo.kind,
		match,
		names: Array.from(new Set([ ...names, ...bodyInfo.extraPeople ])),
		notes: bodyInfo.notes,
		start: bodyInfo.start,
		tag: meetingCounter++,
		title: issue.title,
	}
}

function parseBodyInfo(tpac: TpacDays, body: string): Partial<ParsedGhBodyInfo> {
	// GitHub API line-ending weirdness: https://github.com/actions/runner/issues/1462#issuecomment-2676329157
	const bodyLines = body.split(/\r?\n/)

	const calendarUrl = bodyLines.shift()
	const rawDay = bodyLines.shift()?.toLowerCase()
	const day = isDay(rawDay) ? rawDay : undefined
	const startOfDay = day ? tpac[day].midnight : undefined
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

	return { calendarUrl, day, start, end, extraPeople, notes: bodyLines.join('\n') }
}

function timeStringToPlainDateTime(startOfDay: Temporal.PlainDateTime, time: string): Temporal.PlainDateTime {
	const [ hours, minutes ] = time.split(':').map(s => parseInt(s))
	return startOfDay.add(Temporal.Duration.from({ hours, minutes }))
}
