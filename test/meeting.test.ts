import { describe, expect, test } from 'vitest'

import { Temporal } from '@js-temporal/polyfill'

import { Clash, Match, clashes, isMeetingInGap, sameActualMeeting, timeMatch } from '../src/meeting.ts'

import type { Meeting } from '../src/meeting.ts'

function mkMeetingStartEnd(start: Temporal.PlainDateTime, end: Temporal.PlainDateTime): Meeting {
	return {
		start,
		end,
		tag: 0,
		kind: 'group',
		calendarTitle: '',
		title: '',
		calendarDay: 'monday',
		day: 'monday',
		calendarStart: new Temporal.PlainDateTime(1925, 4, 28, 1),
		calendarEnd: new Temporal.PlainDateTime(1925, 4, 28, 2),
		match: 'exact',
		calendarRoom: '',
		names: [],
		calendarUrl: '',
		issueUrl: '',
		alternatives: [],
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

		expect(clashes(meeting1, meetingA)).toBe(Clash.NONE)
	})

	test('no clash (separate, swapped)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 17),
			new Temporal.PlainDateTime(2025, 5, 26, 18))

		expect(clashes(meetingA, meeting1)).toBe(Clash.NONE)
	})

	test('near clash (adjacent)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 16),
			new Temporal.PlainDateTime(2025, 5, 26, 17))

		expect(clashes(meeting1, meetingA)).toBe(Clash.NEAR)
	})

	test('near clash (adjacent, swapped)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 16),
			new Temporal.PlainDateTime(2025, 5, 26, 17))

		expect(clashes(meetingA, meeting1)).toBe(Clash.NEAR)
	})

	test('definite clash (overlap)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 13),
			new Temporal.PlainDateTime(2025, 5, 26, 15))

		expect(clashes(meeting1, meetingA)).toBe(Clash.DEFO)
	})

	test('definite clash (overlap, swapped)', () => {
		const meeting1 = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 14),
			new Temporal.PlainDateTime(2025, 5, 26, 16))

		const meetingA = mkMeetingStartEnd(
			new Temporal.PlainDateTime(2025, 5, 26, 13),
			new Temporal.PlainDateTime(2025, 5, 26, 15))

		expect(clashes(meetingA, meeting1)).toBe(Clash.DEFO)
	})
})

describe('timeMatch()', () =>{
	test('exactly overlapping', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
		)).toBe(Match.EXACT)
	})

	test('strict subset', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26, 10, 30),
			new Temporal.PlainDateTime(2026, 8, 26, 11, 42),
		)).toBe(Match.SUBSET)
	})

	test('overlap (start)', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26,  9, 30),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
		)).toBe(Match.NOPE)
	})

	test('overlap (end)', () => {
		expect(timeMatch(
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12),
			new Temporal.PlainDateTime(2026, 8, 26, 10),
			new Temporal.PlainDateTime(2026, 8, 26, 12, 30),
		)).toBe(Match.NOPE)
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
