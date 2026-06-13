import { Temporal } from '@js-temporal/polyfill'

import sort from './sort.ts'

import type { Kind, Status } from './kind-status.ts'
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
	match: Match
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

export type Clash = 'none' | 'overlap' | 'near'

export type Match = 'exact' | 'subset' | 'mismatch'

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

export function clashes(a: Meeting, b: Meeting): Clash {
	const gap = Temporal.Duration.from({ minutes: 10 })  // FIXME: DRY

	// If one of the meetings was moved, we must go off its calendar start and end times
	const aRealStart = a.match === 'mismatch' ? a.calendarStart : a.start
	const aRealEnd = a.match === 'mismatch' ? a.calendarEnd : a.end
	const bRealStart = b.match === 'mismatch' ? b.calendarStart : b.start
	const bRealEnd = b.match === 'mismatch' ? b.calendarEnd : b.end

	// Normalise meeting order based on start time
	const aStartsBeforeBStarts = PDT.compare(aRealStart, bRealStart) <= 0
	const m = aStartsBeforeBStarts
		? { start: aRealStart, end: aRealEnd }
		: { start: bRealStart, end: bRealEnd }
	const o = aStartsBeforeBStarts
		? { start: bRealStart, end: bRealEnd }
		: { start: aRealStart, end: aRealEnd }

	if (PDT.compare(m.start, o.start) >= 0
	 && PDT.compare(m.start, o.end)   <= 0) return 'overlap'

	// NOTE: Allow first meeting that ends as the second one starts to be a near clash
	if (PDT.compare(m.end,   o.start) >  0
	 && PDT.compare(m.end,   o.end)   <= 0) return 'overlap'

	if (PDT.compare(m.start, o.start.subtract(gap)) >= 0
	 && PDT.compare(m.start, o.end.add(gap))        <= 0) return 'near'

	if (PDT.compare(m.end,   o.start.subtract(gap)) >= 0
	 && PDT.compare(m.end,   o.end.add(gap))        <= 0) return 'near'

	return 'none'
}

export function timeMatch(
	calendarStart: Temporal.PlainDateTime,
	calendarEnd: Temporal.PlainDateTime,
	ourStart: Temporal.PlainDateTime,
	ourEnd: Temporal.PlainDateTime,
): Match {
	const start = PDT.compare(calendarStart, ourStart)
	const end = PDT.compare(calendarEnd, ourEnd)

	if (start === 0 && end === 0) return 'exact'
	if (start <= 0 && end >= 0) return 'subset'
	return 'mismatch'
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
			if (meeting.status === 'cancelled') {
				cancelledMeetings.push(meeting)
			} else {
				validMeetings.push(meeting)
				if (meeting.match === 'mismatch') movedMeetings.push(meeting)
				if (meeting.names.length === 0) unassignedMeetings.push(meeting)
			}
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
