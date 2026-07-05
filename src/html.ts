import fs from 'fs'

import { Temporal } from '@js-temporal/polyfill'

import { isCalendarMeeting } from './calendar.ts'
import { isMeeting } from './meeting.ts'
import { repoFromIssueUrl } from './repo.ts'
import { days } from './day.ts'
import sort from './sort.ts'

import type { CombineNames, DayMeetings, PersonClashingMeetings, PersonDayGaps, PersonDayMeetings, RepoDuplicateMeetings } from './scheduling.ts'
import type { Gap, Match, Meeting } from './meeting.ts'
import type { Kind, Status } from './kind-status.ts'
import type { CalendarMeeting } from './calendar.ts'
import type { TpacDayInfo } from './tpacs.ts'
import type { Day } from './day.ts'
import type { RepoSpec } from '../tsh.ts'

type MeetingCardArgs =
	| { kind: 'calendar', meeting: CalendarMeeting,
			headingLevel: number, repos: RepoSpec[] }
	| { kind: 'meeting',  meeting: Meeting | Partial<Meeting>,
		  headingLevel: number, equivalents: CombineNames }

type MeetingCardHeaderArgs =
	| { kind: 'calendar', meeting: CalendarMeeting,
		  headingLevel: number, seq?: number } // TODO: when is seq not used? cancelled meetings?
	| { kind: 'meeting',  meeting: Meeting | Partial<Meeting>,
		  headingLevel: number }

interface BaseOutputInfo {
	equivalents: CombineNames
	myName: string
	myUrl: string
	style: string
}

// TODO: get DayMeetings into this?
interface MeetingListPageOutputInfo extends BaseOutputInfo {
	allMeetings: (CalendarMeeting | Partial<Meeting>)[]
	dayInfo: TpacDayInfo
	repos: RepoSpec[]
	script: string
}

interface SchedulingPageOutputInfo extends BaseOutputInfo {
	cancelledMeetings: Partial<Meeting>[]
	dayMeetings: DayMeetings
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

const BEFORE_TPAC_ID = 'before'
const BEFORE_TPAC_HEADING = 'Before TPAC'
const UNKNOWN_PROPERTY = '???'

let headingCounter = 0

export function makeMeetingListPage({
	allMeetings,
	dayInfo,
	equivalents,
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
			<nav>
				<h2>Meeting Days</h2>
				${meetingListDayLinks()}
			</nav>
			<main>`

	const htmlEnd = `</main>
		<footer>
			<p>Generated with <a href="${myUrl}">${myName}</a>.</p>
		</footer>
		<script>${fs.readFileSync(script, 'utf-8')}</script>
		</body></html>`

	const beforeAndDayMeeitngs = new Map([ null, ...days ].map(era => [ era, [] ])) as Map<Day | null | undefined, string[]>

	for (const meeting of allMeetings) {
		const key = meeting.calendarStart
			? Temporal.PlainDateTime.compare(meeting.calendarStart, dayInfo.monday.midnight) < 0
				? null
				: meeting.calendarDay
			: undefined

		// FIXME: Can we get rid of both isCalendarMeeting() and the 'kind' parameter?
		if (isCalendarMeeting(meeting)) {
			beforeAndDayMeeitngs.get(key)?.push(
				meetingCard({ kind: 'calendar', meeting, headingLevel: 1, repos }))
		} else {
			beforeAndDayMeeitngs.get(key)?.push(
				meetingCard({ kind: 'meeting', meeting, headingLevel: 1, equivalents }))
		}
	}

	const dayMeetings = beforeAndDayMeeitngs.entries().reduce((acc: string, entry) => {
		const [ key, meetings ] = entry
		if (key !== undefined) {
			const id = key === null ? BEFORE_TPAC_ID : key
			const heading = key === null ? BEFORE_TPAC_HEADING : pretty(key)
			return acc +
				sectionWithLandmarkOpening(2, false, id, heading) +
				'<div class="meeting-container">' +
				meetings.join('\n') +
				'</div></section>'
		}
		return acc
	}, '')

	return htmlStart + dayMeetings + htmlEnd
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

function meetingListDayLinks() {
	return '<ul>' + [ BEFORE_TPAC_ID ].concat(days).map(occasion =>
		`<li><p><a href="#${occasion}">
				${occasion === BEFORE_TPAC_ID ? BEFORE_TPAC_HEADING : pretty(occasion)}
			</a></p></li>`).join('')
		+ '</ul>'
}

function sectionWithLandmarkOpening(
	headingLevel: number,
	restrained: boolean,
	id: string,
	heading: string,
): string {
	const klass = restrained ? ' class="restrained"' : ''
	return `<section aria-labelledby="${id}"${klass}>
		<h${String(headingLevel)} id="${id}">${heading}</h${String(headingLevel)}>`
}

function sectionWithLandmark(
	headingLevel: number,
	restrained: boolean,
	id: string,
	heading: string,
	content: string,
): string {
	return sectionWithLandmarkOpening(headingLevel, restrained, id, heading) + content + '</section>'
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

function dayMeetingLinks(dms: DayMeetings, equivalents: CombineNames): string {
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

function dayMeetingCards(dms: DayMeetings, equivalents: CombineNames): string {
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
	equivalents: CombineNames,
): string {
	return '<div class="meeting-container">' +
		meetings.map(meeting => meetingCard({
			kind: 'meeting',
			meeting,
			headingLevel: meetingsLevel,
			equivalents,
		})).join('\n') +
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

function timetable(pdm: PersonDayMeetings, pdg: PersonDayGaps, combined: CombineNames) {
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

function listItem(meeting: Meeting, includeDay: boolean, combined: CombineNames, skipName?: string): string {
	return `<li><p>${inlineSummary(meeting, includeDay, combined, skipName)}</p></li>`
}

function inlineSummary(meeting: Meeting, includeDay: boolean, combned: CombineNames, skipName?: string): string {
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
	return text ? text.replace('<', '&lt;').replace('>', '&gt;') : UNKNOWN_PROPERTY
}

function meetingCardHeader<T extends MeetingCardHeaderArgs>(args: T): string {
	const nature: Nature[] = []
	const klasslist: string[] = []

	if (args.kind !== 'calendar') {
		if (args.meeting.match) nature.push(args.meeting.match)
		if (!isMeeting(args.meeting)) {
			nature.push('invalid')
		}
	}
	if (args.meeting.status) nature.push(args.meeting.status)

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

	const fullHeadingId = args.kind === 'calendar' && args.seq ? ` id="${idFor(args.seq, 'heading')}"` : ''
	const tag = args.kind !== 'calendar' && args.meeting.id ? ` id="${String(args.meeting.tag)}"` : ''
	const vitals = args.kind !== 'calendar' ? `<p><i>${htmlEscapeThatNeedsImproving(args.meeting.title)}</i> <span>from: ${args.meeting.issueUrl ? repoFromIssueUrl(args.meeting.issueUrl) ?? UNKNOWN_PROPERTY : UNKNOWN_PROPERTY}</span></p>` : ''

	return `<div${tag} class="meeting${klasses}">
		<hgroup>
			<h${String(args.headingLevel)}${fullHeadingId}>${htmlEscapeThatNeedsImproving(args.meeting.calendarTitle)}</h${String(args.headingLevel)}>
			${vitals}
		</hgroup>
		<dl>
			<dt>Kind</dt><dd>${args.meeting.kind ? kindPretty[args.meeting.kind] : UNKNOWN_PROPERTY}</dd>
			<dt>Status</dt><dd>${args.meeting.status ? statusPretty[args.meeting.status] : UNKNOWN_PROPERTY}</dd>`
}

function meetingCard<T extends MeetingCardArgs>(args: T): string {
	let out = ''
	let tail = ''

	if (args.kind === 'calendar') {
		const { meeting, headingLevel, repos } = args
		if (meeting.status !== 'cancelled') {
			const seq = headingCounter++
			out += meetingCardHeader({ kind: 'calendar', meeting, headingLevel, seq })
			tail = newIssueForm(repos, seq)
		} else {
			out += meetingCardHeader({ kind: 'calendar', meeting, headingLevel })
		}
	} else {
		const { meeting, headingLevel } = args
		out += meetingCardHeader({ kind: 'meeting', meeting, headingLevel })
	}

	// FIXME: Don't include day - or include it with date - if outside of TPAC week
	if (args.kind !== 'calendar' && args.meeting.match === 'mismatch' && args.meeting.day !== args.meeting.calendarDay) {
		out += `<dt>Calendar day</dt><dd>${pretty(args.meeting.calendarDay)}</dd>`
		out += `<dt>Our day</dt><dd>${pretty(args.meeting.day)}</dd>`
	} else {
		out += `<dt>Day</dt><dd>${pretty(args.meeting.calendarDay)}</dd>`
	}

	if (args.kind !== 'calendar' && args.meeting.match !== 'exact') {
		out += `<dt>Calendar time</dt><dd>${dtf(args.meeting.calendarStart)}&ndash;${dtf(args.meeting.calendarEnd)}</dd>`
		out += `<dt>Our time</dt><dd>${dtf(args.meeting.start)}&ndash;${dtf(args.meeting.end)}</dd>`
	} else {
		out += `<dt>Time</dt><dd>${dtf(args.meeting.calendarStart)}&ndash;${dtf(args.meeting.calendarEnd)}</dd>`
	}

	out += `<dt>Room</dt><dd>${args.meeting.room ?? UNKNOWN_PROPERTY}</dd>`
	if (args.kind === 'meeting' && args.equivalents && args.meeting.names) out += `<dt>People</dt><dd>${args.meeting.names ? people(args.meeting.names, args.equivalents) : UNKNOWN_PROPERTY}</dd>`
	out += `<dt>Calendar URL</dt><dd><a href="${args.meeting.calendarUrl ?? UNKNOWN_PROPERTY}">${args.meeting.calendarUrl ?? UNKNOWN_PROPERTY}</a></dd>`
	if ('issueUrl' in args.meeting) out += `<dt>Our issue URL</dt><dd><a href="${args.meeting.issueUrl ?? UNKNOWN_PROPERTY}">${args.meeting.issueUrl ?? UNKNOWN_PROPERTY}</a></dd>`

	if (args.kind !== 'calendar' && args.meeting.match) out += `<dt>Time match</dt><dd>${matchPretty[args.meeting.match]}</dd>`
	if (args.kind !== 'calendar' && (args.meeting.alternatives?.length ?? 0) > 0) {
		out += `<dt>Alternatives</dt><dd>${prettyAlts(args.meeting as Meeting)}</dd>`
	}
	out += '</dl>'

	if (args.kind !== 'calendar') out += notes(args.meeting)

	return out + tail + '</div>'
}

function newIssueForm(repos: RepoSpec[], seq: number) {
	const SEP = ' :: '
	const buttonId = idFor(seq, 'button')
	const repoId = idFor(seq, 'repo')

	const options = repos.reduce((out, [ repo, label ]) =>
		out + `<option data-repo="${repo}" data-label="${label}">${repo}${SEP}${label.length ? label : '(no label)'}</option>`
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

function clashingMeetings(pcm: PersonClashingMeetings, kind: string, combined: CombineNames): string {
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

function possibleDuplicates(rdm: RepoDuplicateMeetings, combined: CombineNames): string {
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

function unassignedList(unassigned: Meeting[], combined: CombineNames): string {
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

function people(names: string[], combined: CombineNames): string {
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
