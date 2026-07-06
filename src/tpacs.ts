import { Temporal } from '@js-temporal/polyfill'

import type { Day } from './day.ts'

export const tpacYears = [ 2025, 2026 ] as const
export type TpacYear = typeof tpacYears[number]

export type TpacDayInfo = Record<Day, {
	midnight: Temporal.PlainDateTime
	start: Temporal.PlainDateTime
	end: Temporal.PlainDateTime
}>

interface Tpac {
	icsUrl: string,
	days: TpacDayInfo
}

type Tpacs = Record<TpacYear, Tpac>

const TPACs: Tpacs = {
	2025: {
		icsUrl: 'https://www.w3.org/calendar/tpac2025/export/',
		days: {
			monday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 10),
				   start: new Temporal.PlainDateTime(2025, 11, 10, 9),
				     end: new Temporal.PlainDateTime(2025, 11, 10, 18),
			},
			tuesday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 11),
				   start: new Temporal.PlainDateTime(2025, 11, 11,  8, 30),
				     end: new Temporal.PlainDateTime(2025, 11, 11, 18, 30),
			},
			wednesday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 12),
				   start: new Temporal.PlainDateTime(2025, 11, 12,  8, 30),
				     end: new Temporal.PlainDateTime(2025, 11, 12, 20, 30),
			},
			thursday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 13),
				   start: new Temporal.PlainDateTime(2025, 11, 13, 7, 30),
				     end: new Temporal.PlainDateTime(2025, 11, 13, 18),
			},
			friday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 14),
				   start: new Temporal.PlainDateTime(2025, 11, 14, 9),
				     end: new Temporal.PlainDateTime(2025, 11, 14, 18),
			},
		},
	},
	2026: {
		icsUrl: 'https://www.w3.org/calendar/tpac2026/export/',
		days: {
			monday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 26),
				   start: new Temporal.PlainDateTime(2026, 10, 26, 8),
				     end: new Temporal.PlainDateTime(2026, 10, 26, 18),
			},
			tuesday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 27),
				   start: new Temporal.PlainDateTime(2026, 10, 27, 8),
				     end: new Temporal.PlainDateTime(2026, 10, 27, 18),
			},
			wednesday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 28),
				   start: new Temporal.PlainDateTime(2026, 10, 28, 8),
				     end: new Temporal.PlainDateTime(2026, 10, 28, 18),
			},
			thursday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 29),
				   start: new Temporal.PlainDateTime(2026, 10, 29, 8),
				     end: new Temporal.PlainDateTime(2026, 10, 29, 18),
			},
			friday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 30),
				   start: new Temporal.PlainDateTime(2026, 10, 30, 8),
				     end: new Temporal.PlainDateTime(2026, 10, 30, 18),
			},
		},
	},
} as const

export default TPACs
