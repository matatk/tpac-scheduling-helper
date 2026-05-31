import fs from 'fs'

import { Temporal } from '@js-temporal/polyfill'

import { repo } from './repo.ts'
import { Match } from './meeting.ts'
import sort from './sort.ts'

import type { CombinedNames, DayMeetings, PersonClashingMeetings, PersonDayGaps, PersonDayMeetings, RepoDuplicateMeetings } from './scheduling.ts'
import type { Day } from './day.ts'
import type { Gap, Meeting } from './meeting.ts'

interface OutputInfo {
	cancelledMeetings: Partial<Meeting>[]
	dayMeetings: DayMeetings
	equivalents: CombinedNames
	haveDefinitelyClashing: boolean  // TODO: remove need for
	haveNearlyClashing: boolean      // TODO: remove need for
	invalidMeetings: Partial<Meeting>[]
	movedMeetings: Meeting[]
	myName: string
	peopleDefinitelyClashingMeetings: PersonClashingMeetings
	peopleNearlyClashingMeetings: PersonClashingMeetings
	personDayGaps: PersonDayGaps
	personDayMeetings: PersonDayMeetings
	repoPossibleDuplicates: RepoDuplicateMeetings
	style: string
	unassignedMeetings: Meeting[]
	validMeetings: Meeting[]
}

export function makeHtml({
	cancelledMeetings,
	dayMeetings,
	equivalents,
	haveDefinitelyClashing,
	haveNearlyClashing,
	invalidMeetings,
	movedMeetings,
	myName,
	peopleDefinitelyClashingMeetings,
	peopleNearlyClashingMeetings,
	personDayGaps,
	personDayMeetings,
	repoPossibleDuplicates,
	style,
	unassignedMeetings,
	validMeetings,
}: OutputInfo): string {
	const haveInvalid = invalidMeetings.length > 0
	const haveMeetings = validMeetings.length > 0
	const haveMoved = movedMeetings.length > 0
	const havePossibleDuplicates = repoPossibleDuplicates.size > 0
	const haveUnassigned = unassignedMeetings.length > 0
	const haveCancelled = cancelledMeetings.length > 0

	const plannedLinks = htmlDayMeetingLinks(dayMeetings, equivalents)
	const planned = outputPlannedMeetings(validMeetings, equivalents, true)

	const headingGroupResults = 'Group results'
	const headingPersonalResults = 'Personal results'

	const invalidId = 'invalid'
	const invalidHeading = 'Invalid meeting entries'

	const movedId = 'moved-meetings'
	const movedHeading = 'Moved meetings'

	const possibleDuplicatesId = 'possible-duplicates'
	const possibleDuplicatesHeading = 'Possible duplicate meetings'

	const unassignedId = 'unassigned'
	const unassignedHeading = 'Meetings without assignees'

	const plannedId = 'planned'
	const plannedHeading = 'Planned meetings'

	const cancelledId = 'cancelled'
	const cancelledHeading = 'Cancelled meetings'

	const clashingId = 'clashing'
	const clashingHeading = 'Clashing meetings'

	const nearlyClashingId = 'nearly-clashing'
	const nearlyClashingHeading = 'Nearly clashing meetings'

	const timetableId = 'timetable'
	const timetableHeading = 'Timetable'

	const htmlStart = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>${myName}</title>
			<meta name="color-scheme" content="dark light" />
			<style>${fs.readFileSync(style, 'utf-8')}</style>
			${peopleSelectorStyle(personDayMeetings)}
		</head>
		<body>
			<header>
				<h1>${myName}</h1>
			</header>
			<nav>
				<h2>Navigation and filtering</h2>
				<h3>${headingGroupResults}</h3>
				<ul>
					<li><p>${sectionLink(haveInvalid, invalidId, invalidHeading)}</p></li>
					<li><p>${sectionLink(haveMoved, movedId, movedHeading)}</p></li>
					<li><p>${sectionLink(havePossibleDuplicates, possibleDuplicatesId, possibleDuplicatesHeading)}</p></li>
					<li><p>${sectionLink(haveUnassigned, unassignedId, unassignedHeading)}</p></li>
					<li><p>${sectionLink(haveMeetings, plannedId, plannedHeading)}</p></li>
					<li><p>${sectionLink(haveCancelled, cancelledId, cancelledHeading)}</p></li>
				</ul>
				<h3>${headingPersonalResults}</h3>
				${peopleSelector(personDayMeetings)}
				<ul>
					<li><p>${sectionLink(haveDefinitelyClashing, clashingId, clashingHeading)}</p></li>
					<li><p>${sectionLink(haveNearlyClashing, nearlyClashingId, nearlyClashingHeading)}</p></li>
					<li><p>${sectionLink(true, timetableId, timetableHeading)}</p></li>
				</ul>
			</nav>
			<main>`
	// FIXME: I don't know my name, but I know my URL...
	const htmlEnd = `</main>
		<footer>
			<p>Generated with <a href="https://github.com/matatk/tpac-scheduling-helper">${myName}</a>.</p>
		</footer>
		</body></html>`

	const html = htmlStart +
		`<h2>${headingGroupResults}</h2>` +
		(haveInvalid
			? `<h3 id="${invalidId}">${invalidHeading}</h3>` +
				outputUnprocessableMeetings(invalidMeetings, equivalents, 'invalid')
			: '') +
		(haveMoved
			? `<h3 id="${movedId}">${movedHeading}</h3>` +
				outputPlannedMeetings(movedMeetings, equivalents, false)
			: '') +
		(havePossibleDuplicates
			? `<h3 id="${possibleDuplicatesId}">${possibleDuplicatesHeading}</h3>` +
				'<p>If there are multiple tracking issues in the same repo that refer to the same Calendar meeting, they may be duplicates (they may also be referring to separate parts of the same, longer, meeting).</p>' +
				'<p>Tracking issues in <em>different</em> repos that refer to the same Calendar entry are not automatically considerd possible duplicates.</p>' +
				outputPossibleDuplicateMeetings(repoPossibleDuplicates, equivalents)
			: '') +
		(haveUnassigned
			? `<h3 id="${unassignedId}">${unassignedHeading}</h3>` +
				outputUnassignedMeetings(unassignedMeetings, equivalents)
			: '') +
		(haveMeetings
			? `<h3 id="${plannedId}">${plannedHeading}</h3>` +
				'<h4>Summary</h4>' +
				plannedLinks +
				planned
			: '') +
		(haveCancelled
			? `<h3 id="${cancelledId}">${cancelledHeading}</h3>` +
				outputUnprocessableMeetings(cancelledMeetings, equivalents, 'cancelled')
			: '') +
		`<h2>${headingPersonalResults}</h2>` +
		(haveDefinitelyClashing
			? `<h3 id="${clashingId}">${clashingHeading}</h3>` +
				outputClashingMeetings(peopleDefinitelyClashingMeetings, 'Definitely', equivalents)
			: '') +
		(haveNearlyClashing
			? `<h3 id="${nearlyClashingId}">${nearlyClashingHeading}</h3>` +
				outputClashingMeetings(peopleNearlyClashingMeetings, 'Nearly', equivalents)
			: '') +
		(true
			? `<h3 id="${timetableId}">${timetableHeading}</h3>` +
				outputTimetable(personDayMeetings, personDayGaps, equivalents)
			: '') +
		htmlEnd

	return html
}

function htmlDayMeetingLinks(dms: DayMeetings, equivalents: CombinedNames): string {
	let html = '<ul>'
	for (const [ day, meetings ] of dms) {
		html += `<li>${pretty(day)}<ul>`
		if (meetings.length > 0) {
			for (const meeting of meetings) {
				html += listItemFor(meeting, false, equivalents)
			}
		} else {
			html += '<p>(none)</p>'
		}
		html += '</ul></i>'
	}
	html += '</ul>'
	return html
}

function outputPlannedMeetings(pms: Meeting[], equivalents: CombinedNames, showDay: boolean): string {
	let html = ''
	let currentDay: Day | null = null

	for (const meeting of pms) {
		if (showDay && meeting.calendarDay !== currentDay) {
			currentDay = meeting.calendarDay
			html += `<h4>${pretty(meeting.calendarDay)}</h4>`
		}
		html += htmlForMeeting(meeting, equivalents)
	}

	return html
}

function peopleSelector(pms: PersonDayMeetings): string {
	if (pms.size === 0) return ''
	let html = '<label>Filter for <select><option selected>everyone</option>'
	pms.forEach((_, name) => html += `<option value="${name}">${name}</option>`)
	return html + '</select></label>'
}

function peopleSelectorStyle(pms: PersonDayMeetings): string {
	let html = `<style>
		section[data-person] {
		}

		body:has(select > option:not([value]):checked) section[data-person] {
		}`

	pms.forEach((_, name) => {
		html += `body:has(select > option[value="${name}"]:checked) section[data-person="${name}"] {
		}`
	})

	return html + '</style>'
}

function sectionLink(flag: boolean, idref: string, pretty: string) {
	return flag
		? `<a href="#${idref}">${pretty}</a>`
		: `${pretty} (none)`
}


function outputTimetable(pdm: PersonDayMeetings, pdg: PersonDayGaps, combined: CombinedNames) {
	const tTop = `<table>
		<thead>
			<tr>
				<th><p>Monday</p></th>
				<th><p>Tuesday</p></th>
				<th><p>Wednesday</p></th>
				<th><p>Thursday</p></th>
				<th><p>Friday</p></th>
			</tr>
		</thead>
		<tbody>`

	const sortedNames = [ ...pdg.keys() ].sort()

	let html = ''

	for (const name of sortedNames) {
		const dayGaps = pdg.get(name)!
		html += `<section data-person="${name}">`
		html += `<h4 id="timetable-${name}">${name}</h4>`
		html += tTop + '<tr>'
		for (const [ day, gaps ] of dayGaps) {
			html += '<td><ul>'

			// TODO: TS can't infer type
			const activities: (Meeting | Gap)[] = [ ...pdm.get(name)?.get(day) ?? [], ...gaps ]
			sort(activities)

			for (const activity of activities) {
				if ('kind' in activity) {
					html += listItemFor(activity, false, combined, name)
				} else {
					html += `<li><p>Free ${dtf(activity.start)} to ${dtf(activity.end)}</p></li>`
				}
			}

			html += '</ul></td>'
		}
		html += '</tr></tbody></table></section>'
	}

	return html
}

function listItemFor(meeting: Meeting, includeDay: boolean, combined: CombinedNames, skipName?: string): string {
	return `<li><p>${oneLinerFor(meeting, includeDay, combined, skipName)}</p></li>`
}


function oneLinerFor(meeting: Meeting, includeDay: boolean, combned: CombinedNames, skipName?: string): string {
	const maybeDay = includeDay ? pretty(meeting.calendarDay) + ' ' : ''
	const names = skipName
		? meeting.names.filter(name => name !== skipName)
		: meeting.names
	const nameHtml = names.length > 0
		? `, <i>${people(names, combned)}</i>`
		: ''
	return `<a href="#${meeting.tag}">${htmlEscapeThatNeedsImproving(meeting.calendarTitle)}</a>, <b>${maybeDay}${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</b>, ${meeting.calendarRoom}${nameHtml}`
}

function htmlEscapeThatNeedsImproving(text?: string): string | undefined {
	if (text) return text.replace('<', '&lt;').replace('>', '&gt;')
	return
}

function htmlMeetingHeader(meeting: Partial<Meeting>, condition: string): string {
	return `<div id="${meeting.tag}" class="meeting ${condition}">
		<h4>${htmlEscapeThatNeedsImproving(meeting.calendarTitle)}</h4>
		<p><i>${htmlEscapeThatNeedsImproving(meeting.title)}</i> <span>from: ${meeting.issueUrl ? repo(meeting.issueUrl) : null}</span></p>
		<dl>
			<dt>Kind</dt><dd>${meeting.kind}</dd>`
}

function htmlForMeeting(meeting: Meeting, combined: CombinedNames): string {
	let out = ''

	if (meeting.match === Match.NOPE && meeting.day !== meeting.calendarDay) {
		out += `<dt>Calendar day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
		out += `<dt>Our day</dt><dd>${pretty(meeting.day)}</dd>`
	} else {
		out += `<dt>Day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
	}

	if (meeting.match !== Match.EXACT) {
		out += `<dt>Calendar time</dt><dd>${dtf(meeting.calendarStart)}&ndash;${dtf(meeting.calendarEnd)}</dd>`
		out += `<dt>Our time</dt><dd>${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</dd>`
	} else {
		out += `<dt>Time</dt><dd>${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</dd>`
	}

	out += htmlPeopleAndUrls(meeting, combined)
	out += `<dt>Time match</dt><dd>${pretty(meeting.match)}</dd>`
	out += `<dt>Alternatives</dt><dd>${prettyAlts(meeting)}</dd>`
	out += '</dl>'

	out += htmlNotes(meeting)

	out += '</div>'

	// TODO: Make the mapping of condition to string more type-y?
	return htmlMeetingHeader(meeting, meeting.match) + out
}

function htmlForPartialMeeting(meeting: Partial<Meeting>, combined: CombinedNames, klass: string): string {
	let out = htmlMeetingHeader(meeting, klass)

	out += `<dt>Calendar day</dt><dd>${meeting.calendarDay ? pretty(meeting.calendarDay) : '???'}</dd>`
	out += `<dt>Our day</dt><dd>${meeting.day ? pretty(meeting.day) : '???'}</dd>`

	out += `<dt>Calendar time</dt><dd>${meeting.calendarStart ? dtf(meeting.calendarStart) : '??'}&ndash;${meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??'}</dd>`
	out += `<dt>Our time</dt><dd>${meeting.start ? dtf(meeting.start) : '??'}&ndash;${meeting.end ? dtf(meeting.end) : '??'}</dd>`

	out += htmlPeopleAndUrls(meeting, combined)

	out += '</dl>'
	out += htmlNotes(meeting)

	out += '</div>'

	return out
}

function outputClashingMeetings(pcm: PersonClashingMeetings, kind: string, combined: CombinedNames): string {
	let html = ''
	for (const [ name, cms ] of pcm) {
		if (cms.size) {
			html += `<section data-person="${name}">`
			html += `<h4>${kind} clashing meetings for ${name}</h4><ul class="clashing">`
			for (const [ m, o ] of cms) {
				html += `<li>
					<p>${oneLinerFor(m, true, combined, name)}</p>${htmlAlternativesOrNot(m)}
					<p>and</p>
					<p>${oneLinerFor(o, true, combined, name)}</p>${htmlAlternativesOrNot(o)}</li>`
			}
			html += '</ul>'
			html += '</section>'
		}
	}
	return html
}

function outputPossibleDuplicateMeetings(rdm: RepoDuplicateMeetings, combined: CombinedNames): string {
	let html = ''
	for (const [ repo, possibleDupes ] of rdm) {
		html += `<h4>Possibly duplicate meetings in ${repo}</h4>`
		for (const [ index, meetings ] of possibleDupes.entries()) {
			html += `<p>Set of possible duplicates ${index + 1}:</p>`
			html += '<ul>'
			for (const m of meetings) {
				html += `<li><p>${oneLinerFor(m, true, combined)}</p></li>`
			}
			html += '</ul>'
		}
	}
	return html
}

function outputUnassignedMeetings(unassigned: Meeting[], combined: CombinedNames): string {
	let html = ''
	html += '<ul>'
	for (const meeting of unassigned) {
		html += `<li><p>${oneLinerFor(meeting, true, combined)}</p></li>`
	}
	html += '</ul>'
	return html
}

function htmlPeopleAndUrls(meeting: Partial<Meeting>, combined: CombinedNames): string {
	let out = ''
	out += `<dt>Room</dt><dd>${meeting.calendarRoom ?? '???'}</dd>`
	out += `<dt>People</dt><dd>${meeting.names ? people(meeting.names, combined) : '???'}</dd>`
	out += `<dt>Calendar URL</dt><dd><a href="${meeting.calendarUrl}">${meeting.calendarUrl}</a></dd>`
	out += `<dt>Our issue URL</dt><dd><a href="${meeting.issueUrl}">${meeting.issueUrl}</a></dd>`
	return out
}

function htmlNotes(meeting: Partial<Meeting>): string {
	if (meeting.notes) {
		return `<details>
			<summary>Meeting notes</summary>
			<pre>${meeting.notes}</pre>
		</details>`
	}
	return ''
}

function people(names: string[], combined: CombinedNames): string {
	return names.map(name => combined.has(name)
		? combined.get(name) + ' (' + name + ')'
		: name).join(', ')
}

function dtf(pdt: Temporal.PlainDateTime): string {
	return pdt.toLocaleString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
	})
}

function pretty(thing: string): string {
	return thing.charAt(0).toUpperCase() + thing.slice(1)
}

function prettyAlts(m: Meeting): string {
	return m.alternatives.length > 0 ? m.alternatives.join(', ') : '(none)'
}

function htmlAlternativesOrNot(m: Meeting): string {
	if (m.alternatives.length > 0) return `<p><strong>Possible alternative attendees:</strong> ${prettyAlts(m)}</p>`
	return ''
}

function outputUnprocessableMeetings(ims: Partial<Meeting>[], equivalents: CombinedNames, klass: string): string {
	if (ims.length === 0) return ''
	let html = ''

	ims.forEach(p => {
		html += htmlForPartialMeeting(p, equivalents, klass)
	})

	return html
}
