import fs from 'fs'
import { spawnSync } from 'child_process'

import { convertIcsCalendar } from 'ts-ics'

import type { IcsEvent } from 'ts-ics'

import { days } from './day.ts'

import type { Kind, Status } from './kind.ts'
import type { Day } from './day.ts'

export const _test = { getSchedule, scheduleInfo2025 }

// FIXME: Add an explicit 'error' kind?
export interface CalendarMeetingInfo {
	title: string
	day: Day
	start: string
	end: string
	room: string
	kind: Kind
	status: Status
}

export type EventInfoGetter = (uid: string) => Partial<CalendarMeetingInfo>
export type EventInfoGetterMaker = (localFile: string) => EventInfoGetter

const events: Record<string, IcsEvent> = {}

export function makeEventInfoGetter(calendarUrl: string, localFile: string, getter: (url: string) => Partial<CalendarMeetingInfo>): EventInfoGetter {
	const calendar = convertIcsCalendar(undefined, getSchedule(calendarUrl, localFile))
	for (const event of calendar.events ?? []) {
		events[event.uid] = event
	}
	return getter
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

export function scheduleInfo2025(uid: string): Partial<CalendarMeetingInfo> {
	const event = events[uid]
	if (!event) return { kind: 'nonexistent' }

	function getTime(date?: Date) {
		if (!date) return
		const hours = date.getHours().toString()
		const mins = date.getMinutes().toString().padStart(2, '0')
		return `${hours}:${mins}`
	}

	function getDay(dateDayNumber?: number) {
		if (!dateDayNumber) return
		return days[dateDayNumber - 1] as unknown as Day
	}

	const title = event.summary
	const day = getDay(event.start.local?.date.getDay())
	const start = getTime(event.start.local?.date)
	const end = getTime(event.end?.local?.date)
	const room = event.location
	const kind = event.categories?.includes('Group Meetings')
		? 'group'
		: event.categories?.includes('Breakout Session')
			? 'breakout'
			: 'other'
	const status = event.status == 'CONFIRMED'
		? 'confirmed'
		: event.status === 'CANCELLED'
			? 'cancelled'
			: 'tentative'

	return {
		title,
		day,
		start,
		end,
		room,
		kind,
		status,
	}
}
