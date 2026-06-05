// FIXME: test for breakout vs group? Don't think I am so far
import { describe, expect, test } from 'vitest'

import { makeEventInfoGetter, scheduleInfo2025 } from '../src/schedule-info'

describe('scheduleInfo2025()', () => {
	const eventInfoGetter = makeEventInfoGetter(
		'https://www.w3.org/calendar/tpac2025/export/', // NOTE: trailing slash is required.
		'cache/schedule-2025.ics',
		scheduleInfo2025)

	test('Invalid IDs should give rise to meetings flagged as nonexistent', () => {
		expect(eventInfoGetter('moo')).toStrictEqual({ kind: 'nonexistent' })
	})

	test('Detect a cancelled meeting', () => {
		expect(eventInfoGetter('bae910d9-6349-4935-9f7f-ec924d6cfa08')).toStrictEqual({
			kind: 'group',
			status: 'cancelled',
			day: 'friday',
			start: '14:00',
			end: '16:00',
			title: 'Technical Architecture Group',
			room: 'R19',
		})
	})

	test('Getting info for a valid meeting', () => {
		expect(eventInfoGetter('b7f653c4-107c-4190-97ac-e03d4adafa5f')).toStrictEqual({
			kind: 'group',
			status: 'confirmed',
			day: 'thursday',
			start: '13:45',
			end: '15:00',
			title: 'Sustainable Web IG, Web Performance Working Group joint meeting',
			room: 'Floor 4 - 404',
		})
	})
})
