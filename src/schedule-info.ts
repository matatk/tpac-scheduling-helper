import fs from 'fs'
import { spawnSync } from 'child_process'

import { Temporal } from '@js-temporal/polyfill'
import { convertIcsCalendar } from 'ts-ics'

import type { IcsEvent } from 'ts-ics'

import { days } from './day.ts'

import type { Kind, Status } from './kind-status.ts'
import type { Day } from './day.ts'

export interface CalendarMeetingInfo {
	calendarDay: Day
	calendarEnd: Temporal.PlainDateTime
	calendarStart: Temporal.PlainDateTime
	calendarTitle: string
	calendarUrl: string
	kind: Kind
	room: string  // NOTE: I suppose this _could_ be subject to change, but we don't try to detect that.
	status: Status
}

interface CalendarMeetingInfoNonexistent {
	kind: 'nonexistent'
}

export type EventInfoIterator = () => CalendarMeetingInfo[]
export type EventInfoIteratorGetterMaker = (localFile: string) => EventInfoIterator

export type EventInfoGetter = (uid: string) => CalendarMeetingInfo | CalendarMeetingInfoNonexistent
export type EventInfoGetterMaker = (localFile: string) => EventInfoGetter

const events: Record<string, IcsEvent> = {}

export function makeEventInfoGetter(calendarUrl: string, localFile: string): EventInfoGetter {
	const calendar = convertIcsCalendar(undefined, getSchedule(calendarUrl, localFile))
	// TODO: can do this with reduce and build the thing in this scope, as with the 'iterator' below?
	for (const event of calendar.events ?? []) {
		events[event.uid] = event
	}
	return scheduleInfo2025
}

export function makeEventInfoIterator(calendarUrl: string, localFile: string): EventInfoIterator {
	const calendar = convertIcsCalendar(undefined, getSchedule(calendarUrl, localFile))
	const meetings = calendar.events?.map(calendarInfoFrom) ?? []
	return () => meetings
}

function getSchedule(scheduleUrl: string, path: string) {
	if (!fs.existsSync(path)) {
		console.log('Downloading schedule...')
		const child = spawnSync('curl', [ scheduleUrl, '-o', path ])
		if (child.error) {
			throw new Error(child.stderr.toString())
		}
	}
	return fs.readFileSync(path, 'utf-8')
}

function getTime(date?: Date) {
	if (!date) return
	return new Temporal.PlainDateTime(
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate(),
		date.getHours(),
		date.getMinutes())
}

function getDay(dateDayNumber?: number) {
	if (!dateDayNumber) return
	return days[dateDayNumber - 1] as unknown as Day
}

function failed(event: IcsEvent, field: string): string {
	return `Can't get ${field} from ICS entry: ${JSON.stringify(event, null, 2)}`
}

function calendarInfoFrom(event: IcsEvent): CalendarMeetingInfo {
	const title = event.summary
	const day = getDay(event.start.local?.date.getDay())
	if (!day) throw new Error(failed(event, 'day'))
	const start = getTime(event.start.local?.date)
	if (!start) throw new Error(failed(event, 'start time'))
	const end = getTime(event.end?.local?.date)
	if (!end) throw new Error(failed(event, 'end time'))
	const room = event.location
	if (!room) throw new Error(failed(event, 'room'))
	const kind = event.categories?.includes('Group Meetings')
		? 'group'
		: event.categories?.includes('Breakout Sessions')
			? 'breakout'
			: 'other'
	const status = event.status == 'CONFIRMED'
		? 'confirmed'
		: event.status === 'CANCELLED'
			? 'cancelled'
			: 'tentative'
	const url = event.description?.split('\n')[0]
	if (!url) throw new Error(failed(event, 'URL'))

	return {
		calendarDay: day,
		calendarEnd: end,
		calendarStart: start,
		calendarTitle: title,
		calendarUrl: url,
		kind,
		room: room,
		status,
	}
}

function scheduleInfo2025(uid: string): CalendarMeetingInfo | CalendarMeetingInfoNonexistent {
	const event = events[uid]
	if (!event) return { kind: 'nonexistent' }
	return calendarInfoFrom(event)
}
