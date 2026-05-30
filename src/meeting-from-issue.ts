import { Temporal } from '@js-temporal/polyfill'

import { isDay } from './day.ts'
import { timeMatch } from './meeting.ts'

import type { GetCalendarMeetingInfo } from './calendar-meeting-info.ts'
import type { GhIssue } from '../tsh.ts'
import type { Meeting } from './meeting.ts'
import type { Day } from './day.ts'
import type { TpacDays } from './tpacs.ts'

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
	getter: GetCalendarMeetingInfo,
	issue: GhIssue,
): Meeting | Partial<Meeting> {
	const bodyInfo = _parseBodyInfo(tpac, issue.body)
	bodyInfo.extraPeople ??= []

	const names = issue.assignees.map(assignee => assignee.login)
	const calendarInfo = getter(bodyInfo.calendarUrl ?? '')

	const startOfDay = calendarInfo?.day ? tpac[calendarInfo.day].midnight : undefined
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

export function _parseBodyInfo(tpac: TpacDays, body: string): Partial<ParsedGhBodyInfo> {
	// GitHub API line-ending weirdness: https://github.com/actions/runner/issues/1462#issuecomment-2676329157
	const bodyLines = body.split(/\r?\n/)

	const calendarUrl = bodyLines.shift()
	const rawDay = bodyLines.shift()?.toLowerCase()
	const day = isDay(rawDay) ? rawDay : undefined
	const startOfDay = day ? tpac[day].midnight ?? undefined : undefined
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
