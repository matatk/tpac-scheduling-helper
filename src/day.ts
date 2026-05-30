export const Days = [ 'monday', 'tuesday', 'wednesday', 'thursday', 'friday' ] as const
export type Day = typeof Days[number]

export function isDay(candidate: any): candidate is Day {
	return Days.includes(candidate)
}
