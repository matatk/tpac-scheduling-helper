import { describe, expect, test } from 'vitest'

import { Temporal } from '@js-temporal/polyfill'

import { _parseBodyInfo } from '../src/meeting-from-issue'

describe('_parseBodyInfo()', () => {
	test('well-formed info', () => {
		const fixture = `https://www.w3.org/events/meetings/31046de8-90b7-40f2-9b52-93d2fe0450b5/
Monday
13:45 - 15:00

Test for attending the whole session.`

		expect(_parseBodyInfo(fixture)).toStrictEqual({
			calendarUrl: 'https://www.w3.org/events/meetings/31046de8-90b7-40f2-9b52-93d2fe0450b5/',
			day: 'monday',
			start: new Temporal.PlainDateTime(2025, 11, 10, 13, 45),
			end: new Temporal.PlainDateTime(2025, 11, 10, 15),
			notes: 'Test for attending the whole session.',
			extraPeople: [],
		})
	})

	test('invalid, only URL', () => {
		const fixture = 'https://www.w3.org/events/meetings/31046de8-90b7-40f2-9b52-93d2fe0450b5/'

		expect(_parseBodyInfo(fixture)).toStrictEqual({
			calendarUrl: 'https://www.w3.org/events/meetings/31046de8-90b7-40f2-9b52-93d2fe0450b5/',
			day: undefined,
			start: undefined,
			end: undefined,
			notes: '',
			extraPeople: [],
		})
	})
})
