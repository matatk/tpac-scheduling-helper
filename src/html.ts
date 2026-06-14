import fs from 'fs'

import { Temporal } from '@js-temporal/polyfill'

import { repo } from './repo.ts'
import sort from './sort.ts'

import type { CombinedNames, DayMeetings, PersonClashingMeetings, PersonDayGaps, PersonDayMeetings, RepoDuplicateMeetings } from './scheduling.ts'
import type { Gap, Match, Meeting } from './meeting.ts'
import type { Kind, Status } from './kind-status.ts'

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

type UnprocessableReason = 'invalid' | 'cancelled'

const kindPretty: Record<Kind, string> = {
	group: 'Group',
	breakout: 'Breakout',
	other: 'SOME OTHER KIND OF EVENT THAT I AM NOT SURE ABOUT',
	nonexistent: "(doesn't exist)",
} as const

const matchPretty: Record<Match, string> = {
	exact: 'Attending whole meeting',
	subset: 'Attending part of meeting',
	mismatch: 'Mismatch between our times and calendar',
}

const statusPretty: Record<Status, string> = {
	tentative: 'Tentative',
	confirmed: 'Confirmed',
	cancelled: 'Cancelled',
} as const

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
	const planned = outputDayMeetings(dayMeetings, equivalents)

	const navFilteringId = 'nav-and-filtering'
	const navFilteringHeading = 'Navigation and filtering'

	const groupResultsId = 'group-results'
	const groupResultsHeading = 'Group results'

	const personalResultsId = 'personal-results'
	const personalResultsHeading = 'Personal results'

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
			<nav aria-labelledby="${navFilteringId}">
				<h2 id=${navFilteringId}>${navFilteringHeading}</h2>
				<h3>${groupResultsHeading}</h3>
				<ul>
					<li><p>${sectionLink(haveInvalid, invalidId, invalidHeading)}</p></li>
					<li><p>${sectionLink(haveMoved, movedId, movedHeading)}</p></li>
					<li><p>${sectionLink(havePossibleDuplicates, possibleDuplicatesId, possibleDuplicatesHeading)}</p></li>
					<li><p>${sectionLink(haveUnassigned, unassignedId, unassignedHeading)}</p></li>
					<li><p>${sectionLink(haveMeetings, plannedId, plannedHeading)}</p></li>
					<li><p>${sectionLink(haveCancelled, cancelledId, cancelledHeading)}</p></li>
				</ul>
				<h3>${personalResultsHeading}</h3>
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

	let html = htmlStart + `<section aria-labelledby="${groupResultsId}">
		<h2 id="${groupResultsId}">${groupResultsHeading}</h2>`

	if (html) html += section(3, false, invalidId, invalidHeading, [], outputUnprocessableMeetings(4, invalidMeetings, equivalents, 'invalid'))
	if (haveMoved) html += section(3, false, movedId, movedHeading, [], outputMeetings(4, movedMeetings, equivalents))
	if (havePossibleDuplicates) {
		html += section(3, true, possibleDuplicatesId, possibleDuplicatesHeading, [
			'<p>If there are multiple tracking issues in the same repo that refer to the same Calendar meeting, they may be duplicates (they may also be referring to separate parts of the same, longer, meeting).</p>',
			'<p>Tracking issues in <em>different</em> repos that refer to the same Calendar entry are not automatically considerd possible duplicates.</p>',
		], outputPossibleDuplicateMeetings(repoPossibleDuplicates, equivalents))
	}
	if (haveUnassigned) html += section(3, true, unassignedId, unassignedHeading, [], outputUnassignedMeetings(unassignedMeetings, equivalents))
	if (haveMeetings) html += section(3, false, plannedId, plannedHeading, [
		section(4, true, 'planned-summary', 'Summary', [], plannedLinks),
	], planned)
	if (haveCancelled) html += section(3, false, cancelledId, cancelledHeading, [], outputUnprocessableMeetings(4, cancelledMeetings, equivalents, 'cancelled'))

	html += '</section>'

	html += `<section aria-labelledby="${personalResultsId}">
		<h2 id="${personalResultsId}">${personalResultsHeading}</h2>`

	if (haveDefinitelyClashing) html += section(3, true, clashingId, clashingHeading, [], outputClashingMeetings(peopleDefinitelyClashingMeetings, 'Definitely', equivalents))
	if (haveNearlyClashing) html += section(3, false, nearlyClashingId, nearlyClashingHeading, [], outputClashingMeetings(peopleNearlyClashingMeetings, 'Nearly', equivalents))

	html += section(3, false, timetableId, timetableHeading, [], outputTimetable(personDayMeetings, personDayGaps, equivalents))

	html += '</section>'

	return html + htmlEnd
}

function section(
	headingLevel: number,
	restrained: boolean,
	id: string,
	heading: string,
	top: string[],
	content: string,
): string {
	const klass = restrained ? ' class="restrained"' : ''
	return `<section aria-labelledby="${id}"${klass}>
		<h${String(headingLevel)} id="${id}">${heading}</h${String(headingLevel)}>
		${top.join('\n')}
		${content}
	</section>`
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

function outputDayMeetings(dms: DayMeetings, equivalents: CombinedNames): string {
	let html = ''

	for (const day of dms.keys()) {
		const meetings = dms.get(day)!
		html += section(4, false, day, pretty(day), [],
			meetings.length > 0 ? outputMeetings(5, meetings, equivalents) : '<p>(none)</p>')
	}

	return html
}

// TODO: DRY with outputUnprocessableMeetings()
function outputMeetings(meetingsLevel: number, meetings: Meeting[], equivalents: CombinedNames): string {
	return '<div class="meeting-container">' +
		meetings.map(meeting => htmlForMeeting(meetingsLevel, meeting, equivalents)).join('\n') +
		'</div>'
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
			display: none;
		}

		body:has(select > option:not([value]):checked) section[data-person] {
			display: block;
		}`

	pms.forEach((_, name) => {
		html += `body:has(select > option[value="${name}"]:checked) section[data-person="${name}"] {
			display: block;
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
		html += `<h4 id="${name}">${name}</h4>`
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
	const realStart = meeting.match === 'mismatch'
		? meeting.calendarStart
		: meeting.start
	const realEnd = meeting.match === 'mismatch'
		? meeting.calendarEnd
		: meeting.end
	const movedMaybe = meeting.match === 'mismatch'
		? ' (moved)'
		: ''
	return `<a href="#${String(meeting.tag)}">${htmlEscapeThatNeedsImproving(meeting.calendarTitle)}</a>, <b>${maybeDay}${dtf(realStart)}&ndash;${dtf(realEnd)}${movedMaybe}</b>, ${meeting.calendarRoom}${nameHtml}`
}

function htmlEscapeThatNeedsImproving(text?: string): string {
	return text ? text.replace('<', '&lt;').replace('>', '&gt;') : '???'
}

function htmlMeetingHeader(
	headingLevel: number,
	meeting: Partial<Meeting>,
	nature: Match | UnprocessableReason,
): string {
	let klass: string

	switch (nature) {
		case 'exact': klass = 'match-exact'; break
		case 'subset': klass = 'match-subset'; break
		case 'mismatch': klass = 'match-miss'; break
		case 'cancelled': klass = 'cancelled'; break
		case 'invalid': klass = 'invalid'; break
	}

	return `<div id="${String(meeting.tag)}" class="meeting ${klass}">
		<div>
			<h${String(headingLevel)}>${htmlEscapeThatNeedsImproving(meeting.calendarTitle)}</h${String(headingLevel)}>
			<p><i>${htmlEscapeThatNeedsImproving(meeting.title)}</i> <span>from: ${meeting.issueUrl ? repo(meeting.issueUrl) : '???'}</span></p>
		</div>
		<dl>
			<dt>Kind</dt><dd>${meeting.kind ? kindPretty[meeting.kind] : '???'}</dd>
			<dt>Status</dt><dd>${meeting.status ? statusPretty[meeting.status] : '???'}</dd>`
}

function htmlForMeeting(headingLevel: number, meeting: Meeting, combined: CombinedNames): string {
	let out = ''

	if (meeting.match === 'mismatch' && meeting.day !== meeting.calendarDay) {
		out += `<dt>Calendar day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
		out += `<dt>Our day</dt><dd>${pretty(meeting.day)}</dd>`
	} else {
		out += `<dt>Day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
	}

	if (meeting.match !== 'exact') {
		out += `<dt>Calendar time</dt><dd>${dtf(meeting.calendarStart)}&ndash;${dtf(meeting.calendarEnd)}</dd>`
		out += `<dt>Our time</dt><dd>${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</dd>`
	} else {
		out += `<dt>Time</dt><dd>${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</dd>`
	}

	out += htmlPeopleAndUrls(meeting, combined)
	out += `<dt>Time match</dt><dd>${matchPretty[meeting.match]}</dd>`
	out += `<dt>Alternatives</dt><dd>${prettyAlts(meeting)}</dd>`
	out += '</dl>'

	out += htmlNotes(meeting)

	out += '</div>'

	// TODO: Make the mapping of condition to string more type-y?
	return htmlMeetingHeader(headingLevel, meeting, meeting.match) + out
}

function htmlForPartialMeeting(headingLevel: number, meeting: Partial<Meeting>, combined: CombinedNames, reason: UnprocessableReason): string {
	let out = htmlMeetingHeader(headingLevel, meeting, reason)

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
			html += `<h4>${kind} clashing meetings for ${name}</h4><ol class="clashing">`
			for (const [ m, o ] of cms) {
				html += `<li>
					<p>${oneLinerFor(m, true, combined, name)}</p>${htmlAlternativesOrNot(m)}
					<p>and</p>
					<p>${oneLinerFor(o, true, combined, name)}</p>${htmlAlternativesOrNot(o)}</li>`
			}
			html += '</ol>'
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
			html += `<p>Set of possible duplicates ${String(index + 1)}:</p>`
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
	out += `<dt>Calendar URL</dt><dd><a href="${meeting.calendarUrl ?? '???'}">${meeting.calendarUrl ?? '???'}</a></dd>`
	out += `<dt>Our issue URL</dt><dd><a href="${meeting.issueUrl ?? '???'}">${meeting.issueUrl ?? '???'}</a></dd>`
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
		? combined.get(name)! + ' (' + name + ')'
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

// TODO: DRY with outputMeetings()
function outputUnprocessableMeetings(meetingsLevel: number, ims: Partial<Meeting>[], equivalents: CombinedNames, reason: UnprocessableReason): string {
	if (ims.length === 0) return ''
	let html = ''

	ims.forEach(p => {
		html += htmlForPartialMeeting(meetingsLevel, p, equivalents, reason)
	})

	return '<div class="meeting-container">' +
		html +
		'</div>'
}
