import { Temporal } from '@js-temporal/polyfill'

export const Days = [ 'monday', 'tuesday', 'wednesday', 'thursday', 'friday' ] as const
export type Day = typeof Days[number]

export function isDay(candidate: any): candidate is Day {
	return Days.includes(candidate)
}

export function startOfDayFrom(candidate: Day): Temporal.PlainDateTime {
	switch (candidate) {
		case 'monday':
			return new Temporal.PlainDateTime(2025, 11, 10)
		case 'tuesday':
			return new Temporal.PlainDateTime(2025, 11, 11)
		case 'wednesday':
			return new Temporal.PlainDateTime(2025, 11, 12)
		case 'thursday':
			return new Temporal.PlainDateTime(2025, 11, 13)
		case 'friday':
			return new Temporal.PlainDateTime(2025, 11, 14)
	}
}
