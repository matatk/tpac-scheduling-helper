import { describe, expect, test } from 'vitest'

import { Temporal } from '@js-temporal/polyfill'

import { clashes, isMeetingInGap, sameActualMeeting, timeMatch } from '../src/meeting.ts'

import type { Meeting } from '../src/meeting.ts'

function mkMeetingStartEnd(
	start: Temporal.PlainDateTime,
	end: Temporal.PlainDateTime,
	calStart?: Temporal.PlainDateTime,
	calEnd?: Temporal.PlainDateTime,
): Meeting {
	if (calStart === start && calEnd === end) {
		throw new Error("When specifying a calendar start and end, they should differ from the values for 'our' start and end.")
	}

	const calendarStart = calStart ?? start
	const calendarEnd = calEnd ?? end

	return {
		alternatives: [],
		calendarDay: 'monday',
		calendarEnd,
		room: '',
		calendarStart,
		calendarTitle: '',
		calendarUrl: '',
		day: 'monday',
		end,
		id: '',
		issueUrl: '',
		kind: 'group',
		match: calStart || calEnd ? 'mismatch' : 'exact',
		names: [],
		start,
		status: 'confirmed',
		tag: 0,
		title: '',
	}
}

function mkMeetingStartEndUrl(
	start: Temporal.PlainDateTime,
	end: Temporal.PlainDateTime,
	calendarUrl: string,
): Meeting {
	return { ...mkMeetingStartEnd(start, end), calendarUrl }
}

describe('isMeetingInGap()', () => {
	test('meeting not in gap (separate)', () => {
		const gap = {
			start: new Temporal.PlainDateTime(2025, 4, 28, 9),
			end: new Temporal.PlainDateTime(2025, 4, 28, 10),
		}

		const meeting = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 4, 28, 11),
			new Temporal.PlainDateTime(2025, 4, 28, 12))

		expect(isMeetingInGap(meeting, gap)).toBe(false)
	})

	test('meeting not in gap (overlapping from middle)', () => {
		const gap = {
			start: new Temporal.PlainDateTime(2025, 4, 28, 9),
			end: new Temporal.PlainDateTime(2025, 4, 28, 10),
		}

		const meeting = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 4, 28, 9, 30),
			new Temporal.PlainDateTime(2025, 4, 28, 10, 30))

		expect(isMeetingInGap(meeting, gap)).toBe(false)
	})

	test('meeting in gap (exactly the same size)', () => {
		const gap = {
			start: new Temporal.PlainDateTime(2025, 4, 28, 9),
			end: new Temporal.PlainDateTime(2025, 4, 28, 10),
		}

		const meeting = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 4, 28, 9),
			new Temporal.PlainDateTime(2025, 4, 28, 10))

		expect(isMeetingInGap(meeting, gap)).toBe(true)
	})

	test('meeting in gap (meeting is smaller than gap)', () => {
		const gap = {
			start: new Temporal.PlainDateTime(2025, 4, 28, 9),
			end: new Temporal.PlainDateTime(2025, 4, 28, 10),
		}

		const meeting = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 4, 28, 9, 38),
			new Temporal.PlainDateTime(2025, 4, 28, 9, 42))

		expect(isMeetingInGap(meeting, gap)).toBe(true)
	})
})

describe('clashes()', () => {
	test('no clash (separate)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 17),
			new Temporal.PlainDateTime(2025, 5, 26, 18))

		expect(clashes(meeting1, meetingA)).toBe('none')
		expect(clashes(meetingA, meeting1)).toBe('none')
	})

	test('near clash (adjacent)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 16),
			new Temporal.PlainDateTime(2025, 5, 26, 17))

		expect(clashes(meeting1, meetingA)).toBe('near')
		expect(clashes(meetingA, meeting1)).toBe('near')
	})

	test('definite clash (overlap)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 13),
			new Temporal.PlainDateTime(2025, 5, 26, 15))

		expect(clashes(meeting1, meetingA)).toBe('overlap')
		expect(clashes(meetingA, meeting1)).toBe('overlap')
	})

	test("meeting that's moved that clashes", () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 13),
			new Temporal.PlainDateTime(2025, 5, 26, 15))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16),
			new Temporal.PlainDateTime(2025, 5, 26, 15),
			new Temporal.PlainDateTime(2025, 5, 26, 17))

		expect(clashes(meeting1, meetingA)).toBe('near')
		expect(clashes(meetingA, meeting1)).toBe('near')
	})
})

describe('timeMatch()', () =>{
	test('exactly overlapping', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
		)).toBe('exact')
	})

	test('strict subset', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26, 10, 30),
			new Temporal.PlainDateTime(2026, 8, 26, 11, 42),
		)).toBe('subset')
	})

	test('overlap (start)', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26,  9, 30),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
		)).toBe('mismatch')
	})

	test('overlap (end)', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12, 30),
		)).toBe('mismatch')
	})
})

describe('sameActualMeeting()', () => {
	test('same', () => {
		const one = mkMeetingStartEndUrl(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			'https://my.cool.meeting/yeah')

		const other = mkMeetingStartEndUrl(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			'https://my.cool.meeting/yeah')

		expect(sameActualMeeting(one, other)).toBe(true)
	})

	test('same times, different URL', () => {
		const one = mkMeetingStartEndUrl(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			'https://somewhere/somehow')

		const other = mkMeetingStartEndUrl(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			'https://my.cool.meeting/yeah')

		expect(sameActualMeeting(one, other)).toBe(false)
	})
})
