import fs from 'fs'

import { Temporal } from '@js-temporal/polyfill'

import { sort, repo } from '../tsh.ts'
import { Match } from './meetings.ts'

import type { RepoDuplicateMeetings, PersonClashingMeetings, PersonDayMeetings, PersonDayGaps, DayMeetings, CombinedNames } from '../tsh.ts'
import type { Day } from './day.ts'
import type { Gap, Meeting } from './meetings.ts'

export function makeHtml(invalidMeetings: Partial<Meeting>[], meetings: Meeting[], movedMeetings: Meeting[], repoPossibleDuplicates: RepoDuplicateMeetings, unassignedMeetings: Meeting[], cancelledMeetings: Partial<Meeting>[], peopleNearlyClashingMeetings: PersonClashingMeetings, peopleDefinitelyClashingMeetings: PersonClashingMeetings, personDayMeetings: PersonDayMeetings, equivalents: CombinedNames, dayMeetings:DayMeetings, haveDefinitelyClashing: boolean, haveNearlyClashing: boolean, personDayGaps:PersonDayGaps, style: string, myName: string) {
	const haveInvalid = invalidMeetings.length > 0
	const haveMeetings = meetings.length > 0
	const haveMoved = movedMeetings.length > 0
	const havePossibleDuplicates = repoPossibleDuplicates.size > 0
	const haveUnassigned = unassignedMeetings.length > 0
	const haveCancelled = cancelledMeetings.length > 0

	const plannedLinks = htmlDayMeetingLinks(dayMeetings, equivalents)
	const planned = outputPlannedMeetings(meetings, equivalents, true)

	const invalidId = 'invalid'
	const invalidHeading = 'Invalid meeting entries'

	const possibleDuplicatesId = 'possible-duplicates'
	const possibleDuplicatesHeading = 'Possible duplicate meetings'

	const movedId = 'moved-meetings'
	const movedHeading = 'Moved meetings'

	const clashingId = 'clashing'
	const clashingHeading = 'Clashing meetings'

	const nearlyClashingId = 'nearly-clashing'
	const nearlyClashingHeading = 'Nearly clashing meetings'

	const unassignedId = 'unassigned'
	const unassignedHeading = 'Meetings without assignees'

	const plannedId = 'planned'
	const plannedHeading = 'Planned meetings'

	const cancelledId = 'cancelled'
	const cancelledHeading = 'Cancelled meetings'

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
				${peopleSelector(personDayMeetings)}
				<ul>
					<li><p>${sectionLink(haveInvalid, invalidId, invalidHeading)}</p></li>
					<li><p>${sectionLink(haveMoved, movedId, movedHeading)}</p></li>
					<li><p>${sectionLink(havePossibleDuplicates, possibleDuplicatesId, possibleDuplicatesHeading)}</p></li>
					<li><p>${sectionLink(haveDefinitelyClashing, clashingId, clashingHeading)}</p></li>
					<li><p>${sectionLink(haveNearlyClashing, nearlyClashingId, nearlyClashingHeading)}</p></li>
					<li><p>${sectionLink(haveUnassigned, unassignedId, unassignedHeading)}</p></li>
					<li><p>${sectionLink(haveMeetings, plannedId, plannedHeading)}</p></li>
					<li><p>${sectionLink(haveCancelled, cancelledId, cancelledHeading)}</p></li>
					<li><p>${sectionLink(true, timetableId, timetableHeading)}</p></li>
				</ul>
			</nav>
			<main>`
	const htmlEnd = '</main></body></html>'

	const html = htmlStart +
		(haveInvalid
			? `<h2 id="${invalidId}">${invalidHeading}</h2>` +
				outputUnprocessableMeetings(invalidMeetings, equivalents, 'invalid')
			: '') +
		(haveMoved
			? `<h2 id="${movedId}">${movedHeading}</h2>` +
				outputPlannedMeetings(movedMeetings, equivalents, false)
			: '') +
		(havePossibleDuplicates
			? `<h2 id="${possibleDuplicatesId}">${possibleDuplicatesHeading}</h2>` +
				'<p>If there are multiple tracking issues in the same repo that refer to the same Calendar meeting, they may be duplicates (they may also be referring to separate parts of the same, longer, meeting).</p>' +
				'<p>Tracking issues in <em>different</em> repos that refer to the same Calendar entry are not automatically considerd possible duplicates.</p>' +
				outputPossibleDuplicateMeetings(repoPossibleDuplicates, equivalents)
			: '') +
		(haveDefinitelyClashing
			? `<h2 id="${clashingId}">${clashingHeading}</h2>` +
				outputClashingMeetings(peopleDefinitelyClashingMeetings, 'Definitely', equivalents)
			: '') +
		(haveNearlyClashing
			? `<h2 id="${nearlyClashingId}">${nearlyClashingHeading}</h2>` +
				outputClashingMeetings(peopleNearlyClashingMeetings, 'Nearly', equivalents)
			: '') +
		(haveUnassigned
			? `<h2 id="${unassignedId}">${unassignedHeading}</h2>` +
				outputUnassignedMeetings(unassignedMeetings, equivalents)
			: '') +
		(haveMeetings
			? `<h2 id="${plannedId}">${plannedHeading}</h2>` +
				'<h3>Summary</h3>' +
				plannedLinks +
				planned
			: '') +
		(haveCancelled
			? `<h2 id="${cancelledId}">${cancelledHeading}</h2>` +
				outputUnprocessableMeetings(cancelledMeetings, equivalents, 'cancelled')
			: '') +
		(true
			? `<h2 id="${timetableId}">${timetableHeading}</h2>` +
				outputTimetable(personDayMeetings, personDayGaps, equivalents)
			: '') +
		htmlEnd

	return html
}

function htmlDayMeetingLinks(dms: DayMeetings, equivalents: CombinedNames): string {
	let html = '<ul>'
	for (const [ day, meetings ] of dms) {
		html += `<li>${pretty(day)}<ul>`
		for (const meeting of meetings) {
			html += listItemFor(meeting, false, equivalents)
		}
		html += '</ul></i>'
	}
	html += '</ul>'
	return html
}

function outputPlannedMeetings(pms: Meeting[], equivalents: CombinedNames, showDay: boolean): string {
	console.log('// Planned meetings')
	console.log()
	let html = ''
	let currentDay: Day | null = null

	for (const meeting of pms) {
		if (showDay && meeting.calendarDay !== currentDay) {
			currentDay = meeting.calendarDay
			console.log(pretty(meeting.calendarDay))
			html += `<h3>${pretty(meeting.calendarDay)}</h3>`
		}
		display(meeting, equivalents)
		console.log()
		html += htmlForMeeting(meeting, equivalents)
	}

	console.log()
	return html
}

function peopleSelector(pms: PersonDayMeetings): string {
	if (pms.size === 0) return ''
	let html = '<label>Show clashing meetings for <select><option selected>everyone</option>'
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
	let html = `<table>
		<thead>
			<tr>
				<th><p>Person</p></th>
				<th><p>Monday</p></th>
				<th><p>Tuesday</p></th>
				<th><p>Wednesday</p></th>
				<th><p>Thursday</p></th>
				<th><p>Friday</p></th>
			</tr>
		</thead>
		<tbody>`

	const sortedNames = [ ...pdg.keys() ].sort()

	for (const name of sortedNames) {
		const dayGaps = pdg.get(name)!
		console.log(`// Timetable for ${name}`)
		html += `<tr id="timetable-${name}"><th scope="row">${name}</th>`
		console.log()
		for (const [ day, gaps ] of dayGaps) {
			console.log(pretty(day))
			html += '<td><ul>'

			// TODO: TS can't infer type
			const activities: (Meeting | Gap)[] = [ ...pdm.get(name)?.get(day) ?? [], ...gaps ]
			sort(activities)

			for (const activity of activities) {
				if ('kind' in activity) {
					console.log(activity.calendarTitle)
					html += listItemFor(activity, false, combined, name)
				} else {
					console.log('Free from', dtf(activity.start), 'to', dtf(activity.end))
					html += `<li><p>Free ${dtf(activity.start)} to ${dtf(activity.end)}</p></li>`
				}
			}

			html += '</ul></td>'
			console.log()
		}
		html += '</tr>'
		console.log()
	}

	return html + '</tbody></table>'
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
		console.log(`// ${kind} clashing meetings for ${name}`)
		console.log()
		if (cms.size) {
			html += `<section data-person="${name}">`
			html += `<h3>${kind} clashing meetings for ${name}</h3><ul class="clashing">`
			for (const [ m, o ] of cms) {
				display(m, combined)
				console.log('...and...')
				display(o, combined)
				html += `<li>
					<p>${oneLinerFor(m, true, combined, name)}</p>${htmlAlternativesOrNot(m)}
					<p>and</p>
					<p>${oneLinerFor(o, true, combined, name)}</p>${htmlAlternativesOrNot(o)}</li>`
				console.log()
			}
			html += '</ul>'
			html += '</section>'
			console.log()
		}
	}
	return html
}

function outputPossibleDuplicateMeetings(rdm: RepoDuplicateMeetings, combined: CombinedNames): string {
	let html = ''
	for (const [ repo, possibleDupes ] of rdm) {
		console.log(`// Possible duplicate meetings in ${repo}`)
		console.log()
		html += `<h3>Possibly duplicate meetings in ${repo}</h3>`
		for (const [ index, meetings ] of possibleDupes.entries()) {
			html += `<p>Set of possible duplicates ${index + 1}:</p>`
			html += '<ul>'
			for (const m of meetings) {
				display(m, combined)
				html += `<li><p>${oneLinerFor(m, true, combined)}</p></li>`
				console.log()
			}
			html += '</ul>'
		}
		console.log()
	}
	return html
}

function outputUnassignedMeetings(unassigned: Meeting[], combined: CombinedNames): string {
	let html = ''
	console.log('// Meetings without any assignees')
	console.log()
	html += '<ul>'
	for (const meeting of unassigned) {
		display(meeting, combined)
		html += `<li><p>${oneLinerFor(meeting, true, combined)}</p></li>`
		console.log()
	}
	html += '</ul>'
	console.log()
	return html
}

// FIXME shouldn't be here; not HTML output
function display(meeting: Meeting, combined: CombinedNames) {
	console.log('      tag:', meeting.tag)
	console.log('     kind:', meeting.kind)
	console.log(`Cal title: ${meeting.calendarTitle}`)
	console.log(`Our title: ${meeting.title}`)
	console.log('     Repo:', repo(meeting.issueUrl))

	if (meeting.match === Match.NOPE) {
		console.log('  Cal day:', pretty(meeting.calendarDay))
		console.log('  Our day:', pretty(meeting.day))
	} else {
		console.log('      Day:', pretty(meeting.day))
	}

	if (meeting.match !== Match.EXACT) {
		console.log(' Cal time:', dtf(meeting.calendarStart), '-', dtf(meeting.calendarEnd))
		console.log(' Our time:', dtf(meeting.start), '-', dtf(meeting.end))
	} else {
		console.log('     Time:', dtf(meeting.start), '-', dtf(meeting.end))
	}

	console.log('     Room:', meeting.calendarRoom)
	console.log('   People:', people(meeting.names, combined))
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.issueUrl)
	console.log('    Match:', pretty(meeting.match))

	console.log('     alts:', prettyAlts(meeting))
}

// FIXME: shouldn't be here; not HTML
// TODO: DRY with above? Would this ever need to display notes, or alternatives?
function displayPartial(meeting: Partial<Meeting>, combined: CombinedNames) {
	console.log('      tag:', meeting.tag)
	console.log('     kind:', meeting.kind)
	console.log(`Cal title: ${meeting.calendarTitle}`)
	console.log(`Our title: ${meeting.title}`)
	console.log('     Repo:', meeting.issueUrl ? repo(meeting.issueUrl) : null)

	console.log('  Cal day:', meeting.calendarDay ? pretty(meeting.calendarDay) : null)
	console.log('  Our day:', meeting.day ? pretty(meeting.day) : null)

	console.log(' Cal time:', meeting.calendarStart ? dtf(meeting.calendarStart) : '??', '-', meeting.calendarEnd ? dtf(meeting.calendarEnd) : '??')
	console.log(' Our time:', meeting.start ? dtf(meeting.start) : '??', '-', meeting.end ? dtf(meeting.end) : '??')

	console.log('     Room:', meeting.calendarRoom ?? null)
	console.log('   People:', meeting.names ? people(meeting.names, combined) : null)
	console.log('  Cal URL:', meeting.calendarUrl)
	console.log('  Our URL:', meeting.issueUrl)
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

	console.log('// Invalid meeting issue entries')
	console.log()
	ims.forEach(p => {
		displayPartial(p, equivalents)
		html += htmlForPartialMeeting(p, equivalents, klass)
		console.log()
	})

	console.log()
	return html
}
