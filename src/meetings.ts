import { Temporal } from '@js-temporal/polyfill'

import { sort } from '../tsh.ts' // FIXME: remove need for this!

import type { Day } from './day.ts'
import type { Kind } from './kind.ts'

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

export const Clash = {
	NONE: 'No clash',
	DEFO: 'CLASHES!',
	NEAR: 'Mind Gap',
} as const
type ClashStatus = typeof Clash[keyof typeof Clash]

export const Match = {
	EXACT: 'exact',
	SUBSET: 'subset',
	NOPE: 'nope',
} as const
type MatchStatus = typeof Match[keyof typeof Match]

export function isMeeting(p: Partial<Meeting>): p is Meeting {
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

// FIXME: Take gaps into account; maybe DRY with below
export function isMeetingInGap(m: Meeting, g: Gap): boolean {
	const buffer = Temporal.Duration.from({ minutes: 10 })  // FIXME: DRY
	return Temporal.PlainDateTime.compare(m.start, g.start) >= 0
		  && Temporal.PlainDateTime.compare(m.start, g.end)   <= 0
		  && Temporal.PlainDateTime.compare(m.end,   g.start) >= 0
	    && Temporal.PlainDateTime.compare(m.end,   g.end)   <= 0
}

export function clashes(a: Meeting, b: Meeting): ClashStatus {
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

export function timeMatch(calendarStart: Temporal.PlainDateTime, calendarEnd: Temporal.PlainDateTime, ourStart: Temporal.PlainDateTime, ourEnd: Temporal.PlainDateTime): MatchStatus {
	const start = Temporal.PlainDateTime.compare(calendarStart, ourStart)
	const end = Temporal.PlainDateTime.compare(calendarEnd, ourEnd)

	if (start === 0 && end === 0) return Match.EXACT
	if (start <= 0 && end >= 0) return Match.SUBSET
	return Match.NOPE
}

export function sameActualMeeting(meeting: Meeting, other: Meeting) {
	return meeting.calendarUrl === other.calendarUrl &&
		meeting.start.equals(other.start) &&
		meeting.end.equals(other.end)
}
