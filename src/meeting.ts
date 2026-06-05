import { Temporal } from '@js-temporal/polyfill'

import sort from './sort.ts'

import type { Kind, Status } from './kind.ts'
import type { Day } from './day.ts'

const PDT = Temporal.PlainDateTime

export interface Meeting {
	tag: number
	kind: Kind
	status: Status
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

interface CategorisedMeetings {
	cancelledMeetings: Partial<Meeting>[]
	invalidMeetings: Partial<Meeting>[]
	movedMeetings: Meeting[]
	validMeetings: Meeting[]
	unassignedMeetings: Meeting[]
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
		!!p.status &&
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
	return PDT.compare(m.start, g.start) >= 0
		  && PDT.compare(m.start, g.end)   <= 0
		  && PDT.compare(m.end,   g.start) >= 0
	    && PDT.compare(m.end,   g.end)   <= 0
}

export function clashes(a: Meeting, b: Meeting): ClashStatus {
	const gap = Temporal.Duration.from({ minutes: 10 })  // FIXME: DRY

	// Normalise meeting order based on start time
	const m = PDT.compare(a.start, b.start) <= 0 ? a : b
	const o = PDT.compare(a.start, b.start) <= 0 ? b : a

	if (PDT.compare(m.start, o.start) >= 0
	 && PDT.compare(m.start, o.end)   <= 0) return Clash.DEFO

	// NOTE: Allow first meeting that ends as the second one starts to be a near clash
	if (PDT.compare(m.end,   o.start) >  0
	 && PDT.compare(m.end,   o.end)   <= 0) return Clash.DEFO

	if (PDT.compare(m.start, o.start.subtract(gap)) >= 0
	 && PDT.compare(m.start, o.end.add(gap))        <= 0) return Clash.NEAR

	if (PDT.compare(m.end,   o.start.subtract(gap)) >= 0
	 && PDT.compare(m.end,   o.end.add(gap))        <= 0) return Clash.NEAR

	return Clash.NONE
}

export function timeMatch(
	calendarStart: Temporal.PlainDateTime,
	calendarEnd: Temporal.PlainDateTime,
	ourStart: Temporal.PlainDateTime,
	ourEnd: Temporal.PlainDateTime,
): MatchStatus {
	const start = PDT.compare(calendarStart, ourStart)
	const end = PDT.compare(calendarEnd, ourEnd)

	if (start === 0 && end === 0) return Match.EXACT
	if (start <= 0 && end >= 0) return Match.SUBSET
	return Match.NOPE
}

export function sameActualMeeting(meeting: Meeting, other: Meeting) {
	return meeting.calendarUrl === other.calendarUrl &&
		meeting.start.equals(other.start) &&
		meeting.end.equals(other.end)
}

export function categoriseMeetings(allMeetings: Partial<Meeting>[]): CategorisedMeetings {
	const validMeetings: Meeting[] = []
	const cancelledMeetings: Partial<Meeting>[] = []
	const invalidMeetings: Partial<Meeting>[] = []
	const movedMeetings: Meeting[] = []
	const unassignedMeetings: Meeting[] = []

	for (const meeting of allMeetings) {
		if (isMeeting(meeting)) {
			if (meeting.match === Match.NOPE) {
				movedMeetings.push(meeting)
			} else {
				validMeetings.push(meeting)
			}
			if (meeting.names.length === 0) {
				unassignedMeetings.push(meeting)
			}
		} else if (meeting.status === 'cancelled') {
			cancelledMeetings.push(meeting)
		} else {
			invalidMeetings.push(meeting)
		}
	}

	sort(validMeetings)
	sort(movedMeetings)
	sort(unassignedMeetings)

	return {
		cancelledMeetings,
		invalidMeetings,
		movedMeetings,
		validMeetings,
		unassignedMeetings,
	}
}
