export const days = [ 'monday', 'tuesday', 'wednesday', 'thursday', 'friday' ] as const
export type Day = typeof days[number]

export function isDay(candidate: unknown): candidate is Day {
	return days.includes(candidate as Day)
}
