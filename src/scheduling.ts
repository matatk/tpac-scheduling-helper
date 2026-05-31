import { Temporal } from '@js-temporal/polyfill'

import ClashingMeetingsSet from './clashing-meetings-set.ts'
import { Days } from './day.ts'
import { Clash, clashes, isMeetingInGap, sameActualMeeting } from './meeting.ts'
import { repo } from './repo.ts'

import type { Day } from './day.ts'
import type { Gap, Meeting } from './meeting.ts'
import type { TpacDays } from './tpacs.ts'

export type CombinedNames = Map<string, string>
type DayThings<T> = Map<Day, T[]>
export type DayMeetings = DayThings<Meeting>
type DayGaps = DayThings<Gap>
export type PersonDayMeetings = Map<string, DayMeetings>
export type PersonClashingMeetings = Map<string, ClashingMeetingsSet>
export type PersonDayGaps = Map<string, DayGaps>
type RepoMeetings = Map<string, Meeting[]>
export type RepoDuplicateMeetings = Map<string, Meeting[][]>

interface ScheduleResult {
	repoPossibleDuplicates: RepoDuplicateMeetings
	peopleNearlyClashingMeetings: PersonClashingMeetings
	peopleDefinitelyClashingMeetings: PersonClashingMeetings
	personDayMeetings: PersonDayMeetings
	dayMeetings: DayMeetings
	haveDefinitelyClashing: boolean
	haveNearlyClashing: boolean
	personDayGaps: PersonDayGaps
}

function dayThings<T extends Meeting | Gap>(): Map<Day, T[]> {
	return new Map(Days.map(day => [ day, [] ]))
}

function alternatives(
	possibleAlternatives: string[],
	personDayGaps: PersonDayGaps,
	meeting: Meeting,
): string[] {
	const out: string[] = []

	for (const person of personDayGaps.keys()) {
		if (meeting.names.includes(person)) continue
		if (possibleAlternatives.length > 0 && !possibleAlternatives.includes(person)) continue
		for (const gap of personDayGaps.get(person)?.get(meeting.day) ?? []) {
			if (isMeetingInGap(meeting, gap)) {
				out.push(person)
			}
		}
	}

	return out
}

function addMeeting<T extends Day | string>(map: Map<T, Meeting[]>, key: T, meeting: Meeting) {
	if (map.has(key)) {
		map.get(key)!.push(meeting)
	} else {
		map.set(key, [ meeting ])
	}
}

function addClashingMeeting(map: Map<string, ClashingMeetingsSet>, name: string, m: Meeting, o: Meeting) {
	if (!map.has(name)) {
		map.set(name, new ClashingMeetingsSet())
	}
	map.get(name)!.add(m, o)
}

export default function processSchedule(
	tpacDays: TpacDays,
	equivalents: CombinedNames,
	alts: string[],
	validMeetings: Meeting[],
): ScheduleResult {
	const dayMeetings: DayMeetings = dayThings<Meeting>()
	const personDayMeetings: PersonDayMeetings = new Map()
	const personDayGaps: PersonDayGaps = new Map()
	const repoMeetings: RepoMeetings = new Map()

	// Track which people are assigned to which meetings, on which days.
	// Also track which meetings came from which repo (to flag possible duplicates).
	for (const meeting of validMeetings) {
		for (const name of meeting.names) {
			const normalisedName = equivalents.get(name) ?? name

			if (!personDayMeetings.has(normalisedName)) {
				personDayMeetings.set(normalisedName, dayThings())
			}
			personDayMeetings.get(normalisedName)?.get(meeting.day)?.push(meeting)

			if (!personDayGaps.has(normalisedName)) {
				personDayGaps.set(normalisedName, dayThings())
			}
		}

		addMeeting(dayMeetings, meeting.calendarDay, meeting)
		addMeeting(repoMeetings, repo(meeting.issueUrl), meeting)
	}

	// Now figure out, for each person, each day, and each meeting:
	// which other meetings they're assigned to clash for sure;
	// and which other meetings are very nearby, so may clash in practice.

	const peopleDefinitelyClashingMeetings: PersonClashingMeetings = new Map()
	const peopleNearlyClashingMeetings: PersonClashingMeetings = new Map()

	let haveDefinitelyClashing = false
	let haveNearlyClashing = false

	for (const [ person, dayMeetings ] of personDayMeetings) {
		for (const [ day, meetings ] of dayMeetings) {
			const workingDay = tpacDays[day]
			let endOfLastMeeting = workingDay.start

			for (const meeting of meetings) {
				// Detecting clashes
				for (const other of meetings) {
					if (meeting === other) continue

					// Cope with the case that the same meeting has been specified in multiple repos.
					if (sameActualMeeting(meeting, other)) continue

					switch (clashes(meeting, other)) {
						case Clash.DEFO:
							addClashingMeeting(peopleDefinitelyClashingMeetings, person, meeting, other)
							haveDefinitelyClashing = true
							break
						case Clash.NEAR:
							addClashingMeeting(peopleNearlyClashingMeetings, person, meeting, other)
							haveNearlyClashing = true
							break
					}
				}

				// Detecting gaps between meetings
				if (Temporal.PlainDateTime.compare(meeting.start, endOfLastMeeting) > 0) {
					personDayGaps.get(person)?.get(day)?.push({
						start: endOfLastMeeting,
						end: meeting.start,
					})
				}
				if (Temporal.PlainDateTime.compare(meeting.end, endOfLastMeeting) > 0) {
					endOfLastMeeting = meeting.end
				}
			}

			if (Temporal.PlainDateTime.compare(endOfLastMeeting, workingDay.end) < 0) {
				personDayGaps.get(person)?.get(day)?.push({
					start: endOfLastMeeting,
					end: workingDay.end,
				})
			}
		}
	}

	// Now we have been through all people, days, and meetings.
	// We can figure out, for all meetings, whom else could attend instead of those assigned.
	for (const meeting of validMeetings) {
		meeting.alternatives.push(...alternatives(alts, personDayGaps, meeting))
	}

	// If multiple issues from the same repo reference the same meeting, they may be duplicates.
	// They may not be duplicates, though: they may reference different sub-parts of the same meeting.
	const repoPossibleDuplicates: RepoDuplicateMeetings = new Map()
	for (const [ repo, meetings ] of repoMeetings) {
		const grouped = Object.groupBy(meetings, meeting => meeting.calendarUrl)
		const possibleDupes = Object.values(grouped).filter(group => group && group.length > 1)
		if (possibleDupes.length > 0) {
			// TODO: the handling of undefined as a possibility seems a bit kludgy here
			repoPossibleDuplicates.set(repo, possibleDupes.filter(v => !!v))
		}
	}

	return {
		repoPossibleDuplicates,
		peopleNearlyClashingMeetings,
		peopleDefinitelyClashingMeetings,
		personDayMeetings,
		dayMeetings,
		haveDefinitelyClashing,
		haveNearlyClashing,
		personDayGaps,
	}
}
