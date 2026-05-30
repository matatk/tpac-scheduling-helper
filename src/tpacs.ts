import { Temporal } from '@js-temporal/polyfill'

import type { Day } from './day.ts'

export const TpacYears = [ 2025 ] as const
export type TpacYear = typeof TpacYears[number]  // TODO: Only exported for type asssertion around args.year

export type TpacDays = Record<Day, {
		midnight: Temporal.PlainDateTime
		start: Temporal.PlainDateTime
		end: Temporal.PlainDateTime
	}>

type Tpacs = {
	[tpac in TpacYear as `tpac${tpac}`]: {
		schedule: string
		days: TpacDays
	}
}

const TPACs: Tpacs = {
	tpac2025: {
		schedule: 'https://www.w3.org/2025/11/TPAC/schedule.html',
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
} as const

export default TPACs
