import { spawnSync } from 'child_process'
import fs from 'fs'

import { JSDOM } from 'jsdom'

import { isDay } from './day.ts'

import type { Day } from './day.ts'
import type { Kind } from './kind.ts'

export interface CalendarMeetingInfo {
	title: string
	day: Day
	start: string
	end: string
	room: string
	kind: Kind
}

export type GetCalendarMeetingInfo = (calendarUrl: string) => Partial<CalendarMeetingInfo>

let dom: JSDOM
let doc: Document

export function makeCalendarMeetingInfoGetter(scheduleUrl: string, localFile: string): GetCalendarMeetingInfo {
	dom = new JSDOM(getSchedule(scheduleUrl, localFile))
	doc = dom.window.document

	return (calendarUrl: string) => calendarMeetingInfo(doc, calendarUrl)
}

function getSchedule(scheduleUrl: string, path: string) {
	if (!fs.existsSync(path)) {
		console.log('Downloading schedule...')
		const child = spawnSync('curl', [ scheduleUrl, '-o', path ])
		if (child.error) {
			throw (child.stderr)
		}
	}
	return fs.readFileSync(path, 'utf-8')
}

function calendarMeetingInfo(doc: Document, url: string): Partial<CalendarMeetingInfo> {
	const link = doc.querySelector(`a[href="${url}"]`)
	if (!link) return { kind: 'cancelled' }

	const parentSection = (link?.parentElement?.parentElement?.parentElement)
	const rawDay = parentSection?.id

	const title = link?.firstElementChild?.textContent
	const start = link?.children[4]?.children[0]?.textContent
	const end = link?.children[4]?.children[1]?.textContent
	const room = link?.children[2]?.textContent
	const kind = link?.classList.contains('breakout') ? 'breakout' : 'group'

	return { title, day: isDay(rawDay) ? rawDay : undefined, start, end, room, kind }
}
