import { describe, expect, test } from 'vitest'

import { Temporal } from '@js-temporal/polyfill'

import { calendarInit, calendarMeeting, calendarMeetingsZipped } from '../src/calendar'

function setUp() {
	calendarInit(
		'https://www.w3.org/calendar/tpac2025/export/', // NOTE: trailing slash is required.
		'cache/schedule-2025.ics')
}

describe('Converting all events', () => {
	setUp()

	test('The correct number of events are got, and converted', () => {
		expect(calendarMeetingsZipped().length).toBe(209)
	})
})

describe('Getting calendar info', () => {
	setUp()

	test('Invalid IDs should give rise to meetings flagged as nonexistent', () => {
		expect(calendarMeeting('moo')).toStrictEqual({ kind: 'nonexistent' })
	})

	test('Detect a cancelled meeting', () => {
		expect(calendarMeeting('bae910d9-6349-4935-9f7f-ec924d6cfa08')).toStrictEqual({
			calendarDay: 'friday',
			calendarEnd: new Temporal.PlainDateTime(2025, 11, 14, 16),
			calendarStart: new Temporal.PlainDateTime(2025, 11, 14, 14),
			calendarTitle: 'Technical Architecture Group',
			calendarUrl: 'https://www.w3.org/events/meetings/bae910d9-6349-4935-9f7f-ec924d6cfa08/',
			kind: 'group',
			room: 'R19',
			status: 'cancelled',
		})
	})

	test('Getting info for a valid meeting', () => {
		expect(calendarMeeting('b7f653c4-107c-4190-97ac-e03d4adafa5f')).toStrictEqual({
			calendarDay: 'thursday',
			calendarEnd: new Temporal.PlainDateTime(2025, 11, 13, 15),
			calendarStart: new Temporal.PlainDateTime(2025, 11, 13, 13, 45),
			calendarTitle: 'Sustainable Web IG, Web Performance Working Group joint meeting',
			calendarUrl: 'https://www.w3.org/events/meetings/b7f653c4-107c-4190-97ac-e03d4adafa5f/',
			kind: 'group',
			room: 'Floor 4 - 404',
			status: 'confirmed',
		})
	})
})
