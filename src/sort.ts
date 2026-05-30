import { Temporal } from '@js-temporal/polyfill'

import type { Meeting, Gap } from './meeting.ts'

export default function sort(activities: (Meeting | Gap)[]) {
	activities.sort((a, b) => Temporal.PlainDateTime.compare(a.start, b.start))
}
