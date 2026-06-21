import fs from 'fs'

import { Temporal } from '@js-temporal/polyfill'

import { isMeeting } from './meeting.ts'
import { repoFromIssueUrl } from './repo.ts'
import sort from './sort.ts'

import type { CombinedNames, DayMeetings, PersonClashingMeetings, PersonDayGaps, PersonDayMeetings, RepoDuplicateMeetings } from './scheduling.ts'
import type { Gap, Match, Meeting } from './meeting.ts'
import type { Kind, Status } from './kind-status.ts'
import type { CalendarMeeting } from './calendar.ts'

interface BaseOutputInfo {
	myName: string
	myUrl: string
	style: string
}

// TODO: get DayMeetings into this?
interface MeetingListPageOutputInfo extends BaseOutputInfo {
	allMeetings: (CalendarMeeting | Partial<Meeting>)[]
	repos: string[]
	script: string
}

interface SchedulingPageOutputInfo extends BaseOutputInfo {
	cancelledMeetings: Partial<Meeting>[]
	dayMeetings: DayMeetings
	equivalents: CombinedNames
	haveDefinitelyClashing: boolean  // TODO: remove need for
	haveNearlyClashing: boolean      // TODO: remove need for
	invalidMeetings: Partial<Meeting>[]
	movedMeetings: Meeting[]
	peopleDefinitelyClashingMeetings: PersonClashingMeetings
	peopleNearlyClashingMeetings: PersonClashingMeetings
	personDayGaps: PersonDayGaps
	personDayMeetings: PersonDayMeetings
	repoPossibleDuplicates: RepoDuplicateMeetings
	unassignedMeetings: Meeting[]
	validMeetings: Meeting[]
}

type Nature = Omit<Status, 'confirmed'> | 'invalid' | Match

const kindPretty: Record<Kind, string> = {
	group: 'Group',
	breakout: 'Breakout',
	other: 'Other',
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

const UNKNOWN_PROPERTY = '???'

let headingCounter = 0

export function makeMeetingListPage({
	allMeetings,
	myName,
	myUrl,
	repos,
	script,
	style,
}: MeetingListPageOutputInfo): string {
	const htmlStart = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>${myName}</title>
			<meta name="color-scheme" content="dark light" />
			<style>${fs.readFileSync(style, 'utf-8')}</style>
		</head>
		<body>
			<header>
				<h1>${myName}: Full Meeting List</h1>
			</header>
			<nav>FIXME: Put something here, or change the styles...</nav>
			<main>
				<div class="meeting-container">`

	const htmlEnd = `</div>
		</main>
		<footer>
			<p>Generated with <a href="${myUrl}">${myName}</a>.</p>
		</footer>
		<script>${fs.readFileSync(script, 'utf-8')}</script>
		</body></html>`

	let htmlMiddle = ''
	for (const meeting of allMeetings) {
		htmlMiddle += meetingCard(1, meeting, repos)
	}

	return htmlStart + htmlMiddle + htmlEnd
}

export function makeSchedulingPage({
	cancelledMeetings,
	dayMeetings,
	equivalents,
	haveDefinitelyClashing,
	haveNearlyClashing,
	invalidMeetings,
	movedMeetings,
	myName,
	myUrl,
	peopleDefinitelyClashingMeetings,
	peopleNearlyClashingMeetings,
	personDayGaps,
	personDayMeetings,
	repoPossibleDuplicates,
	style,
	unassignedMeetings,
	validMeetings,
}: SchedulingPageOutputInfo): string {
	const haveInvalid = invalidMeetings.length > 0
	const haveMeetings = validMeetings.length > 0
	const haveMoved = movedMeetings.length > 0
	const havePossibleDuplicates = repoPossibleDuplicates.size > 0
	const haveUnassigned = unassignedMeetings.length > 0
	const haveCancelled = cancelledMeetings.length > 0

	const plannedLinks = dayMeetingLinks(dayMeetings, equivalents)
	const planned = dayMeetingCards(dayMeetings, equivalents)

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
				<h1>${myName}: Group Timetabling</h1>
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
	const htmlEnd = `</main>
		<footer>
			<p>Generated with <a href="${myUrl}">${myName}</a>.</p>
		</footer>
		</body></html>`

	let html = htmlStart + `<section aria-labelledby="${groupResultsId}">
		<h2 id="${groupResultsId}">${groupResultsHeading}</h2>`

	if (html) html += sectionWithLandmark(3, false, invalidId, invalidHeading,
		meetingCards(4, invalidMeetings, equivalents))
	if (haveMoved) html += sectionWithLandmark(3, false, movedId, movedHeading,
		meetingCards(4, movedMeetings, equivalents))
	if (havePossibleDuplicates) html += sectionWithLandmark(3, true, possibleDuplicatesId, possibleDuplicatesHeading,
		'<p>If there are multiple tracking issues in the same repo that refer to the same Calendar meeting, they may be duplicates (they may also be referring to separate parts of the same, longer, meeting).</p>' +
		'<p>Tracking issues in <em>different</em> repos that refer to the same Calendar entry are not automatically considerd possible duplicates.</p>' +
		possibleDuplicates(repoPossibleDuplicates, equivalents))
	if (haveUnassigned) html += sectionWithLandmark(3, true, unassignedId, unassignedHeading,
		unassignedList(unassignedMeetings, equivalents))
	if (haveMeetings) html += sectionWithLandmark(3, false, plannedId, plannedHeading,
		sectionWithoutLandmark(4, true, 'Summary', plannedLinks) + planned)
	if (haveCancelled) html += sectionWithLandmark(3, false, cancelledId, cancelledHeading,
		meetingCards(4, cancelledMeetings, equivalents))

	html += '</section>'

	html += `<section aria-labelledby="${personalResultsId}">
		<h2 id="${personalResultsId}">${personalResultsHeading}</h2>`

	if (haveDefinitelyClashing) html += sectionWithLandmark(3, true, clashingId, clashingHeading,
		clashingMeetings(peopleDefinitelyClashingMeetings, 'Definitely', equivalents))
	if (haveNearlyClashing) html += sectionWithLandmark(3, false, nearlyClashingId, nearlyClashingHeading,
		clashingMeetings(peopleNearlyClashingMeetings, 'Nearly', equivalents))

	html += sectionWithLandmark(3, false, timetableId, timetableHeading,
		timetable(personDayMeetings, personDayGaps, equivalents))

	html += '</section>'

	return html + htmlEnd
}

function sectionWithLandmark(
	headingLevel: number,
	restrained: boolean,
	id: string,
	heading: string,
	content: string,
): string {
	const klass = restrained ? ' class="restrained"' : ''
	return `<section aria-labelledby="${id}"${klass}>
		<h${String(headingLevel)} id="${id}">${heading}</h${String(headingLevel)}>
		${content}
	</section>`
}

function sectionWithoutLandmark(
	headingLevel: number,
	restrained: boolean,
	heading: string,
	content: string,
): string {
	const klass = restrained ? ' class="restrained"' : ''
	return `<section${klass}>
		<h${String(headingLevel)}>${heading}</h${String(headingLevel)}>
		${content}
	</section>`
}

function dayMeetingLinks(dms: DayMeetings, equivalents: CombinedNames): string {
	let html = '<ul>'
	for (const [ day, meetings ] of dms) {
		html += `<li>${pretty(day)}<ul>`
		if (meetings.length > 0) {
			for (const meeting of meetings) {
				html += listItem(meeting, false, equivalents)
			}
		} else {
			html += '<p>(none)</p>'
		}
		html += '</ul></i>'
	}
	html += '</ul>'
	return html
}

function dayMeetingCards(dms: DayMeetings, equivalents: CombinedNames): string {
	let html = ''

	for (const day of dms.keys()) {
		const meetings = dms.get(day)!
		html += sectionWithoutLandmark(4, false, pretty(day),
			meetings.length > 0 ? meetingCards(5, meetings, equivalents) : '<p>(none)</p>')
	}

	return html
}

function meetingCards(
	meetingsLevel: number,
	meetings: Meeting[] | Partial<Meeting>[],
	equivalents: CombinedNames,
): string {
	return '<div class="meeting-container">' +
		meetings.map(meeting => meetingCard(meetingsLevel, meeting, equivalents)).join('\n') +
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

function timetable(pdm: PersonDayMeetings, pdg: PersonDayGaps, combined: CombinedNames) {
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
					html += listItem(activity, false, combined, name)
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

function listItem(meeting: Meeting, includeDay: boolean, combined: CombinedNames, skipName?: string): string {
	return `<li><p>${inlineSummary(meeting, includeDay, combined, skipName)}</p></li>`
}

function inlineSummary(meeting: Meeting, includeDay: boolean, combned: CombinedNames, skipName?: string): string {
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
	return `<a href="#${String(meeting.tag)}">${htmlEscapeThatNeedsImproving(meeting.calendarTitle)}</a>, <b>${maybeDay}${dtf(realStart)}&ndash;${dtf(realEnd)}${movedMaybe}</b>, ${meeting.room}${nameHtml}`
}

function htmlEscapeThatNeedsImproving(text?: string): string {
	return text ? text.replace('<', '&lt;').replace('>', '&gt;') : '???'
}

function meetingCardHeader(
	headingLevel: number,
	meeting: CalendarMeeting,
): string
function meetingCardHeader(
	headingLevel: number,
	meeting: CalendarMeeting,
	seq: number,
): string
function meetingCardHeader(
	headingLevel: number,
	meeting: Partial<Meeting>,
	valid: false,
): string
function meetingCardHeader(
	headingLevel: number,
	meeting: Meeting,
	valid: true,
): string
function meetingCardHeader(
	headingLevel: number,
	meeting: CalendarMeeting | Partial<Meeting>,
	validOrSeq: boolean | number | undefined,
): string {
	const nature: Nature[] = []
	const klasslist: string[] = []

	const valid = typeof validOrSeq === 'boolean' ? validOrSeq : undefined

	if ('match' in meeting && meeting.match) nature.push(meeting.match)
	if (meeting.status) nature.push(meeting.status)
	if (valid === false) nature.push('invalid')

	for (const state of nature) {
		switch (state) {
			case 'exact': klasslist.push('match-exact'); break
			case 'subset': klasslist.push(' match-subset'); break
			case 'mismatch': klasslist.push('match-miss'); break
			case 'cancelled': klasslist.push('state-cancelled'); break
			case 'tentative': klasslist.push('state-tentative'); break
			case 'invalid': klasslist.push('nature-invalid'); break
		}
	}

	const klasses = klasslist.length > 0 ? ' ' + klasslist.join(' ') : ''
	const fullHeadingId = typeof validOrSeq === 'number' ? ` id="${idFor(validOrSeq, 'heading')}"` : ''
	// TODO: do this a different way? somehow DRY with the full card function?
	const isFullMeeting = isMeeting(meeting)
	const tag = isFullMeeting ? ` id="${String(meeting.tag)}"` : ''
	const vitals = isFullMeeting ? `<p><i>${htmlEscapeThatNeedsImproving(meeting.title)}</i> <span>from: ${meeting.issueUrl ? repoFromIssueUrl(meeting.issueUrl) : '???'}</span></p>` : ''

	return `<div${tag} class="meeting${klasses}">
		<hgroup>
			<h${String(headingLevel)}${fullHeadingId}>${htmlEscapeThatNeedsImproving(meeting.calendarTitle)}</h${String(headingLevel)}>
			${vitals}
		</hgroup>
		<dl>
			<dt>Kind</dt><dd>${meeting.kind ? kindPretty[meeting.kind] : '???'}</dd>
			<dt>Status</dt><dd>${meeting.status ? statusPretty[meeting.status] : '???'}</dd>`
}

// FIXME: Invalid existing issues on list of meetings page are being rendered w/o their GitHub issue title.
function meetingCard(
	headingLevel: number,
	meeting: CalendarMeeting | Partial<Meeting>,
	repos: string[],
): string
function meetingCard(
	headingLevel: number,
	meeting: Meeting | Partial<Meeting>,
	combined: CombinedNames,
): string
function meetingCard(
	headingLevel: number,
	meeting: CalendarMeeting | Meeting | Partial<Meeting>,
	combinedOrRepos: CombinedNames | string[],
): string {
	const isFullMeeting = isMeeting(meeting)
	const matchInMeeting = 'match' in meeting
	let out = ''
	let tail = ''

	const combined = Array.isArray(combinedOrRepos) ? null : combinedOrRepos

	if (isFullMeeting) {
		out += meetingCardHeader(headingLevel, meeting, true)
	}	else if ('title' in meeting) {
		out += meetingCardHeader(headingLevel, meeting, false)
	} else {
		// FIXME: use type guard and that will remove the need for all the casts
		if (meeting.status !== 'cancelled') {
			const seq = headingCounter++
			out += meetingCardHeader(headingLevel, meeting as CalendarMeeting, seq)
			tail = newIssueForm(combinedOrRepos as string[], seq)
		} else {
			out += meetingCardHeader(headingLevel, meeting as CalendarMeeting)
		}
	}

	// FIXME: Don't include day - or include it with date - if outside of TPAC week
	if (matchInMeeting && meeting.match === 'mismatch' && meeting.day !== meeting.calendarDay) {
		out += `<dt>Calendar day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
		out += `<dt>Our day</dt><dd>${pretty(meeting.day)}</dd>`
	} else {
		out += `<dt>Day</dt><dd>${pretty(meeting.calendarDay)}</dd>`
	}

	if (matchInMeeting && meeting.match !== 'exact') {
		out += `<dt>Calendar time</dt><dd>${dtf(meeting.calendarStart)}&ndash;${dtf(meeting.calendarEnd)}</dd>`
		out += `<dt>Our time</dt><dd>${dtf(meeting.start)}&ndash;${dtf(meeting.end)}</dd>`
	} else {
		out += `<dt>Time</dt><dd>${dtf(meeting.calendarStart)}&ndash;${dtf(meeting.calendarEnd)}</dd>`
	}

	out += `<dt>Room</dt><dd>${meeting.room ?? '???'}</dd>`
	if (combined && 'names' in meeting) out += `<dt>People</dt><dd>${meeting.names ? people(meeting.names, combined) : '???'}</dd>`
	out += `<dt>Calendar URL</dt><dd><a href="${meeting.calendarUrl ?? '???'}">${meeting.calendarUrl ?? '???'}</a></dd>`
	if ('issueUrl' in meeting) out += `<dt>Our issue URL</dt><dd><a href="${meeting.issueUrl ?? '???'}">${meeting.issueUrl ?? '???'}</a></dd>`

	if (matchInMeeting && meeting.match) out += `<dt>Time match</dt><dd>${matchPretty[meeting.match]}</dd>`
	if (isFullMeeting) out += `<dt>Alternatives</dt><dd>${prettyAlts(meeting)}</dd>`
	out += '</dl>'

	out += notes(meeting)

	return out + tail + '</div>'
}

function newIssueForm(repos: string[], seq: number) {
	const buttonId = idFor(seq, 'button')
	const repoId = idFor(seq, 'repo')

	const options = repos.reduce((out, repo) =>
		out + `<option value="${repo}">${repo}</option>`
	, '')

	return `
		<form>
			<p>
				<label id="${repoId}">Repo: <select>${options}</select></label>
			</p>
			<button id="${buttonId}"
			  aria-labelledby="${buttonId} ${idFor(seq, 'heading')}"
			  aria-describedby="${repoId}">Plan to attend</button>
		</form>`
}

function clashingMeetings(pcm: PersonClashingMeetings, kind: string, combined: CombinedNames): string {
	let html = ''
	for (const [ name, cms ] of pcm) {
		if (cms.size) {
			html += `<section data-person="${name}">`
			html += `<h4>${kind} clashing meetings for ${name}</h4><ol class="clashing">`
			for (const [ m, o ] of cms) {
				html += `<li>
					<p>${inlineSummary(m, true, combined, name)}</p>${alternativesOrNot(m)}
					<p>and</p>
					<p>${inlineSummary(o, true, combined, name)}</p>${alternativesOrNot(o)}</li>`
			}
			html += '</ol>'
			html += '</section>'
		}
	}
	return html
}

function possibleDuplicates(rdm: RepoDuplicateMeetings, combined: CombinedNames): string {
	let html = ''
	for (const [ repo, possibleDupes ] of rdm) {
		html += `<h4>Possibly duplicate meetings in ${repo}</h4>`
		for (const [ index, meetings ] of possibleDupes.entries()) {
			html += `<p>Set of possible duplicates ${String(index + 1)}:</p>`
			html += '<ul>'
			for (const m of meetings) {
				html += `<li><p>${inlineSummary(m, true, combined)}</p></li>`
			}
			html += '</ul>'
		}
	}
	return html
}

function unassignedList(unassigned: Meeting[], combined: CombinedNames): string {
	let html = ''
	html += '<ul>'
	for (const meeting of unassigned) {
		html += `<li><p>${inlineSummary(meeting, true, combined)}</p></li>`
	}
	html += '</ul>'
	return html
}

function notes(meeting: Partial<Meeting>): string {
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

function dtf(pdt?: Temporal.PlainDateTime): string {
	return pdt
		? pdt.toLocaleString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
		})
		: UNKNOWN_PROPERTY
}

function pretty(thing?: string): string {
	return thing
		? thing.charAt(0).toUpperCase() + thing.slice(1)
		: UNKNOWN_PROPERTY
}

function prettyAlts(m: Meeting): string {
	return m.alternatives.length > 0 ? m.alternatives.join(', ') : '(none)'
}

function alternativesOrNot(m: Meeting): string {
	if (m.alternatives.length > 0) return `<p><strong>Possible alternative attendees:</strong> ${prettyAlts(m)}</p>`
	return ''
}

function idFor(num: number, kind: 'heading' | 'button' | 'repo') {
	return `${kind}-${String(num)}`
}
