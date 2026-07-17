#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import { Temporal } from "@js-temporal/polyfill";
import { spawnSync } from "child_process";
import { convertIcsCalendar } from "ts-ics";
import { URL } from "url";
//#region src/tpacs.ts
const tpacYears = [2025, 2026];
const TPACs = {
	2025: {
		icsUrl: "https://www.w3.org/calendar/tpac2025/export/",
		days: {
			monday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 10),
				start: new Temporal.PlainDateTime(2025, 11, 10, 9),
				end: new Temporal.PlainDateTime(2025, 11, 10, 18)
			},
			tuesday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 11),
				start: new Temporal.PlainDateTime(2025, 11, 11, 8, 30),
				end: new Temporal.PlainDateTime(2025, 11, 11, 18, 30)
			},
			wednesday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 12),
				start: new Temporal.PlainDateTime(2025, 11, 12, 8, 30),
				end: new Temporal.PlainDateTime(2025, 11, 12, 20, 30)
			},
			thursday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 13),
				start: new Temporal.PlainDateTime(2025, 11, 13, 7, 30),
				end: new Temporal.PlainDateTime(2025, 11, 13, 18)
			},
			friday: {
				midnight: new Temporal.PlainDateTime(2025, 11, 14),
				start: new Temporal.PlainDateTime(2025, 11, 14, 9),
				end: new Temporal.PlainDateTime(2025, 11, 14, 18)
			}
		}
	},
	2026: {
		icsUrl: "https://www.w3.org/calendar/tpac2026/export/",
		days: {
			monday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 26),
				start: new Temporal.PlainDateTime(2026, 10, 26, 8),
				end: new Temporal.PlainDateTime(2026, 10, 26, 18)
			},
			tuesday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 27),
				start: new Temporal.PlainDateTime(2026, 10, 27, 8),
				end: new Temporal.PlainDateTime(2026, 10, 27, 18)
			},
			wednesday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 28),
				start: new Temporal.PlainDateTime(2026, 10, 28, 8),
				end: new Temporal.PlainDateTime(2026, 10, 28, 18)
			},
			thursday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 29),
				start: new Temporal.PlainDateTime(2026, 10, 29, 8),
				end: new Temporal.PlainDateTime(2026, 10, 29, 18)
			},
			friday: {
				midnight: new Temporal.PlainDateTime(2026, 10, 30),
				start: new Temporal.PlainDateTime(2026, 10, 30, 8),
				end: new Temporal.PlainDateTime(2026, 10, 30, 18)
			}
		}
	}
};
//#endregion
//#region src/day.ts
const days = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday"
];
function isDay(candidate) {
	return days.includes(candidate);
}
//#endregion
//#region src/calendar.ts
const icsEvents = {};
function isCalendarMeeting(cm) {
	const fields = [
		"calendarDay",
		"calendarEnd",
		"calendarStart",
		"calendarTitle",
		"calendarUrl",
		"kind",
		"room",
		"status"
	];
	for (const field of fields) if (!(field in cm)) return false;
	if (Object.keys(cm).length === fields.length) return true;
	return false;
}
function calendarInit(calendarUrl, localFile) {
	const calendar = convertIcsCalendar(void 0, getSchedule(calendarUrl, localFile));
	for (const event of calendar.events ?? []) icsEvents[event.uid] = event;
}
function calendarMeeting(uid) {
	const event = icsEvents[uid];
	if (!event) return { kind: "nonexistent" };
	return calendarInfoFrom(event);
}
function calendarMeetingsZipped(plannedMeetings = {}) {
	return Object.values(icsEvents).reduce((acc, icsEvent) => {
		if (icsEvent.uid in plannedMeetings) acc.push(...plannedMeetings[icsEvent.uid]);
		else acc.push(calendarInfoFrom(icsEvent));
		return acc;
	}, []);
}
function getSchedule(scheduleUrl, path) {
	if (!fs.existsSync(path)) {
		console.log("Downloading schedule from:", scheduleUrl);
		const child = spawnSync("curl", [
			scheduleUrl,
			"-o",
			path
		]);
		if (child.error) throw new Error(child.stderr.toString());
	}
	return fs.readFileSync(path, "utf-8");
}
function getTime(date) {
	if (!date) return;
	return new Temporal.PlainDateTime(date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes());
}
function getDay(dateDayNumber) {
	if (!dateDayNumber) return;
	return days[dateDayNumber - 1];
}
function failed(event, field) {
	return `Can't get ${field} from ICS entry: ${JSON.stringify(event, null, 2)}`;
}
function calendarInfoFrom(event) {
	const title = event.summary;
	const day = getDay(event.start.local?.date.getDay());
	if (!day) throw new Error(failed(event, "day"));
	const start = getTime(event.start.local?.date);
	if (!start) throw new Error(failed(event, "start time"));
	const end = getTime(event.end?.local?.date);
	if (!end) throw new Error(failed(event, "end time"));
	const room = event.location;
	if (!room) throw new Error(failed(event, "room"));
	const kind = event.categories?.includes("Group Meetings") ? "group" : event.categories?.includes("Breakout Sessions") ? "breakout" : "other";
	const status = event.status == "CONFIRMED" ? "confirmed" : event.status === "CANCELLED" ? "cancelled" : "tentative";
	const url = event.description?.split("\n")[0];
	if (!url) throw new Error(failed(event, "URL"));
	return {
		calendarDay: day,
		calendarEnd: end,
		calendarStart: start,
		calendarTitle: title,
		calendarUrl: url,
		kind,
		room,
		status
	};
}
//#endregion
//#region src/sort.ts
function sort(activities) {
	activities.sort((a, b) => Temporal.PlainDateTime.compare(a.start, b.start));
}
//#endregion
//#region src/meeting.ts
const PDT = Temporal.PlainDateTime;
function isMeeting(p) {
	return !!p.tag && !!p.kind && !!p.status && !!p.calendarTitle && !!p.title && !!p.calendarDay && !!p.day && !!p.calendarStart && !!p.start && !!p.calendarEnd && !!p.end && !!p.match && !!p.room && !!p.names && !!p.calendarUrl && !!p.issueUrl && !!p.alternatives;
}
function isMeetingInGap(m, g) {
	Temporal.Duration.from({ minutes: 10 });
	return PDT.compare(m.start, g.start) >= 0 && PDT.compare(m.start, g.end) <= 0 && PDT.compare(m.end, g.start) >= 0 && PDT.compare(m.end, g.end) <= 0;
}
function clashes(a, b) {
	const gap = Temporal.Duration.from({ minutes: 10 });
	const aRealStart = a.match === "mismatch" ? a.calendarStart : a.start;
	const aRealEnd = a.match === "mismatch" ? a.calendarEnd : a.end;
	const bRealStart = b.match === "mismatch" ? b.calendarStart : b.start;
	const bRealEnd = b.match === "mismatch" ? b.calendarEnd : b.end;
	const aStartsBeforeBStarts = PDT.compare(aRealStart, bRealStart) <= 0;
	const m = aStartsBeforeBStarts ? {
		start: aRealStart,
		end: aRealEnd
	} : {
		start: bRealStart,
		end: bRealEnd
	};
	const o = aStartsBeforeBStarts ? {
		start: bRealStart,
		end: bRealEnd
	} : {
		start: aRealStart,
		end: aRealEnd
	};
	if (PDT.compare(m.start, o.start) >= 0 && PDT.compare(m.start, o.end) <= 0) return "overlap";
	if (PDT.compare(m.end, o.start) > 0 && PDT.compare(m.end, o.end) <= 0) return "overlap";
	if (PDT.compare(m.start, o.start.subtract(gap)) >= 0 && PDT.compare(m.start, o.end.add(gap)) <= 0) return "near";
	if (PDT.compare(m.end, o.start.subtract(gap)) >= 0 && PDT.compare(m.end, o.end.add(gap)) <= 0) return "near";
	return "none";
}
function timeMatch(calendarStart, calendarEnd, ourStart, ourEnd) {
	const start = PDT.compare(calendarStart, ourStart);
	const end = PDT.compare(calendarEnd, ourEnd);
	if (start === 0 && end === 0) return "exact";
	if (start <= 0 && end >= 0) return "subset";
	return "mismatch";
}
function sameActualMeeting(meeting, other) {
	return meeting.calendarUrl === other.calendarUrl && meeting.start.equals(other.start) && meeting.end.equals(other.end);
}
function categoriseMeetings(allMeetings) {
	const validMeetings = [];
	const cancelledMeetings = [];
	const invalidMeetings = [];
	const movedMeetings = [];
	const unassignedMeetings = [];
	for (const meeting of allMeetings) if (isMeeting(meeting)) if (meeting.status === "cancelled") cancelledMeetings.push(meeting);
	else {
		validMeetings.push(meeting);
		if (meeting.match === "mismatch") movedMeetings.push(meeting);
		if (meeting.names.length === 0) unassignedMeetings.push(meeting);
	}
	else invalidMeetings.push(meeting);
	sort(validMeetings);
	sort(movedMeetings);
	sort(unassignedMeetings);
	return {
		cancelledMeetings,
		invalidMeetings,
		movedMeetings,
		validMeetings,
		unassignedMeetings
	};
}
//#endregion
//#region src/repo.ts
function repoFromIssueUrl(issueUrl) {
	const repo = issueUrl.split("/").slice(-4, -2).join("/");
	return repo.length > 0 ? repo : void 0;
}
//#endregion
//#region src/html.ts
const kindPretty = {
	group: "Group",
	breakout: "Breakout",
	other: "Other",
	nonexistent: "(doesn't exist)"
};
const matchPretty = {
	exact: "Attending whole meeting",
	subset: "Attending part of meeting",
	mismatch: "Mismatch between our times and calendar"
};
const statusPretty = {
	tentative: "Tentative",
	confirmed: "Confirmed",
	cancelled: "Cancelled"
};
const BEFORE_TPAC_ID = "before";
const BEFORE_TPAC_HEADING = "Before TPAC";
const UNKNOWN_PROPERTY = "???";
let headingCounter = 0;
function makeMeetingListPage({ allMeetings, dayInfo, equivalents, myName, myUrl, repos, script, style }) {
	const htmlStart = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>${myName}</title>
			<meta name="color-scheme" content="dark light" />
			<style>${fs.readFileSync(style, "utf-8")}</style>
		</head>
		<body>
			<header>
				<h1>${myName}: Full Meeting List</h1>
			</header>
			<nav>
				<h2>Meeting Days</h2>
				${meetingListDayLinks()}
			</nav>
			<main>`;
	const htmlEnd = `</main>
		<footer>
			<p>Generated with <a href="${myUrl}">${myName}</a>.</p>
		</footer>
		<script>${fs.readFileSync(script, "utf-8")}<\/script>
		</body></html>`;
	const beforeAndDayMeeitngs = new Map([null, ...days].map((era) => [era, []]));
	for (const meeting of allMeetings) {
		const key = meeting.calendarStart ? Temporal.PlainDateTime.compare(meeting.calendarStart, dayInfo.monday.midnight) < 0 ? null : meeting.calendarDay : void 0;
		if (isCalendarMeeting(meeting)) beforeAndDayMeeitngs.get(key)?.push(meetingCard({
			kind: "calendar",
			meeting,
			headingLevel: 1,
			repos
		}));
		else beforeAndDayMeeitngs.get(key)?.push(meetingCard({
			kind: "meeting",
			meeting,
			headingLevel: 1,
			equivalents
		}));
	}
	return htmlStart + beforeAndDayMeeitngs.entries().reduce((acc, entry) => {
		const [key, meetings] = entry;
		if (key !== void 0) return acc + sectionWithLandmarkOpening(2, false, key ?? BEFORE_TPAC_ID, key === null ? BEFORE_TPAC_HEADING : pretty(key)) + "<div class=\"meeting-container\">" + meetings.join("\n") + "</div></section>";
		return acc;
	}, "") + htmlEnd;
}
function makeSchedulingPage({ cancelledMeetings, dayMeetings, equivalents, haveDefinitelyClashing, haveNearlyClashing, invalidMeetings, movedMeetings, myName, myUrl, peopleDefinitelyClashingMeetings, peopleNearlyClashingMeetings, personDayGaps, personDayMeetings, repoPossibleDuplicates, style, unassignedMeetings, validMeetings }) {
	const haveInvalid = invalidMeetings.length > 0;
	const haveMeetings = validMeetings.length > 0;
	const haveMoved = movedMeetings.length > 0;
	const havePossibleDuplicates = repoPossibleDuplicates.size > 0;
	const haveUnassigned = unassignedMeetings.length > 0;
	const haveCancelled = cancelledMeetings.length > 0;
	const plannedLinks = dayMeetingLinks(dayMeetings, equivalents);
	const planned = dayMeetingCards(dayMeetings, equivalents);
	const navFilteringId = "nav-and-filtering";
	const navFilteringHeading = "Navigation and filtering";
	const groupResultsId = "group-results";
	const groupResultsHeading = "Group results";
	const personalResultsId = "personal-results";
	const personalResultsHeading = "Personal results";
	const invalidId = "invalid";
	const invalidHeading = "Invalid meeting entries";
	const movedId = "moved-meetings";
	const movedHeading = "Moved meetings";
	const possibleDuplicatesId = "possible-duplicates";
	const possibleDuplicatesHeading = "Possible duplicate meetings";
	const unassignedId = "unassigned";
	const unassignedHeading = "Meetings without assignees";
	const plannedId = "planned";
	const plannedHeading = "Planned meetings";
	const cancelledId = "cancelled";
	const cancelledHeading = "Cancelled meetings";
	const clashingId = "clashing";
	const clashingHeading = "Clashing meetings";
	const nearlyClashingId = "nearly-clashing";
	const nearlyClashingHeading = "Nearly clashing meetings";
	const timetableId = "timetable";
	const timetableHeading = "Timetable";
	const htmlStart = `<!DOCTYPE html>
		<head>
			<meta charset="utf-8">
			<title>${myName}</title>
			<meta name="color-scheme" content="dark light" />
			<style>${fs.readFileSync(style, "utf-8")}</style>
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
			<main>`;
	const htmlEnd = `</main>
		<footer>
			<p>Generated with <a href="${myUrl}">${myName}</a>.</p>
		</footer>
		</body></html>`;
	let html = htmlStart + `<section aria-labelledby="${groupResultsId}">
		<h2 id="${groupResultsId}">${groupResultsHeading}</h2>`;
	if (html) html += sectionWithLandmark(3, false, invalidId, invalidHeading, meetingCards(4, invalidMeetings, equivalents));
	if (haveMoved) html += sectionWithLandmark(3, false, movedId, movedHeading, meetingCards(4, movedMeetings, equivalents));
	if (havePossibleDuplicates) html += sectionWithLandmark(3, true, possibleDuplicatesId, possibleDuplicatesHeading, "<p>If there are multiple tracking issues in the same repo that refer to the same Calendar meeting, they may be duplicates (they may also be referring to separate parts of the same, longer, meeting).</p><p>Tracking issues in <em>different</em> repos that refer to the same Calendar entry are not automatically considerd possible duplicates.</p>" + possibleDuplicates(repoPossibleDuplicates, equivalents));
	if (haveUnassigned) html += sectionWithLandmark(3, true, unassignedId, unassignedHeading, unassignedList(unassignedMeetings, equivalents));
	if (haveMeetings) html += sectionWithLandmark(3, false, plannedId, plannedHeading, sectionWithoutLandmark(4, true, "Summary", plannedLinks) + planned);
	if (haveCancelled) html += sectionWithLandmark(3, false, cancelledId, cancelledHeading, meetingCards(4, cancelledMeetings, equivalents));
	html += "</section>";
	html += `<section aria-labelledby="${personalResultsId}">
		<h2 id="${personalResultsId}">${personalResultsHeading}</h2>`;
	if (haveDefinitelyClashing) html += sectionWithLandmark(3, true, clashingId, clashingHeading, clashingMeetings(peopleDefinitelyClashingMeetings, "Definitely", equivalents));
	if (haveNearlyClashing) html += sectionWithLandmark(3, false, nearlyClashingId, nearlyClashingHeading, clashingMeetings(peopleNearlyClashingMeetings, "Nearly", equivalents));
	html += sectionWithLandmark(3, false, timetableId, timetableHeading, timetable(personDayMeetings, personDayGaps, equivalents));
	html += "</section>";
	return html + htmlEnd;
}
function meetingListDayLinks() {
	return "<ul>" + [BEFORE_TPAC_ID].concat(days).map((occasion) => `<li><p><a href="#${occasion}">
				${occasion === BEFORE_TPAC_ID ? BEFORE_TPAC_HEADING : pretty(occasion)}
			</a></p></li>`).join("") + "</ul>";
}
function sectionWithLandmarkOpening(headingLevel, restrained, id, heading) {
	return `<section aria-labelledby="${id}"${restrained ? " class=\"restrained\"" : ""}>
		<h${String(headingLevel)} id="${id}">${heading}</h${String(headingLevel)}>`;
}
function sectionWithLandmark(headingLevel, restrained, id, heading, content) {
	return sectionWithLandmarkOpening(headingLevel, restrained, id, heading) + content + "</section>";
}
function sectionWithoutLandmark(headingLevel, restrained, heading, content) {
	return `<section${restrained ? " class=\"restrained\"" : ""}>
		<h${String(headingLevel)}>${heading}</h${String(headingLevel)}>
		${content}
	</section>`;
}
function dayMeetingLinks(dms, equivalents) {
	let html = "<ul>";
	for (const [day, meetings] of dms) {
		html += `<li>${pretty(day)}<ul>`;
		if (meetings.length > 0) for (const meeting of meetings) html += listItem(meeting, false, equivalents);
		else html += "<p>(none)</p>";
		html += "</ul></i>";
	}
	html += "</ul>";
	return html;
}
function dayMeetingCards(dms, equivalents) {
	let html = "";
	for (const day of dms.keys()) {
		const meetings = dms.get(day);
		html += sectionWithoutLandmark(4, false, pretty(day), meetings.length > 0 ? meetingCards(5, meetings, equivalents) : "<p>(none)</p>");
	}
	return html;
}
function meetingCards(meetingsLevel, meetings, equivalents) {
	return "<div class=\"meeting-container\">" + meetings.map((meeting) => meetingCard({
		kind: "meeting",
		meeting,
		headingLevel: meetingsLevel,
		equivalents
	})).join("\n") + "</div>";
}
function peopleSelector(pms) {
	if (pms.size === 0) return "";
	let html = "<label>Filter for <select><option selected>everyone</option>";
	pms.forEach((_, name) => html += `<option value="${name}">${name}</option>`);
	return html + "</select></label>";
}
function peopleSelectorStyle(pms) {
	let html = `<style>
		section[data-person] {
			display: none;
		}

		body:has(select > option:not([value]):checked) section[data-person] {
			display: block;
		}`;
	pms.forEach((_, name) => {
		html += `body:has(select > option[value="${name}"]:checked) section[data-person="${name}"] {
			display: block;
		}`;
	});
	return html + "</style>";
}
function sectionLink(flag, idref, pretty) {
	return flag ? `<a href="#${idref}">${pretty}</a>` : `${pretty} (none)`;
}
function timetable(pdm, pdg, combined) {
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
		<tbody>`;
	const sortedNames = [...pdg.keys()].sort();
	let html = "";
	for (const name of sortedNames) {
		const dayGaps = pdg.get(name);
		html += `<section data-person="${name}">`;
		html += `<h4 id="${name}">${name}</h4>`;
		html += tTop + "<tr>";
		for (const [day, gaps] of dayGaps) {
			html += "<td><ul>";
			const activities = [...pdm.get(name)?.get(day) ?? [], ...gaps];
			sort(activities);
			for (const activity of activities) if ("kind" in activity) html += listItem(activity, false, combined, name);
			else html += `<li><p>Free ${dtf(activity.start)} to ${dtf(activity.end)}</p></li>`;
			html += "</ul></td>";
		}
		html += "</tr></tbody></table></section>";
	}
	return html;
}
function listItem(meeting, includeDay, combined, skipName) {
	return `<li><p>${inlineSummary(meeting, includeDay, combined, skipName)}</p></li>`;
}
function inlineSummary(meeting, includeDay, combned, skipName) {
	const maybeDay = includeDay ? pretty(meeting.calendarDay) + " " : "";
	const names = skipName ? meeting.names.filter((name) => name !== skipName) : meeting.names;
	const nameHtml = names.length > 0 ? `, <i>${people(names, combned)}</i>` : "";
	const realStart = meeting.match === "mismatch" ? meeting.calendarStart : meeting.start;
	const realEnd = meeting.match === "mismatch" ? meeting.calendarEnd : meeting.end;
	const movedMaybe = meeting.match === "mismatch" ? " (moved)" : "";
	return `<a href="#${String(meeting.tag)}">${htmlEscapeThatNeedsImproving(meeting.calendarTitle)}</a>, <b>${maybeDay}${dtf(realStart)}&ndash;${dtf(realEnd)}${movedMaybe}</b>, ${meeting.room}${nameHtml}`;
}
function htmlEscapeThatNeedsImproving(text) {
	return text ? text.replace("<", "&lt;").replace(">", "&gt;") : UNKNOWN_PROPERTY;
}
function meetingCardHeader(args) {
	const nature = [];
	const klasslist = [];
	if (args.kind !== "calendar") {
		if (args.meeting.match) nature.push(args.meeting.match);
		if (!isMeeting(args.meeting)) nature.push("invalid");
	}
	if (args.meeting.status) nature.push(args.meeting.status);
	for (const state of nature) switch (state) {
		case "exact":
			klasslist.push("match-exact");
			break;
		case "subset":
			klasslist.push(" match-subset");
			break;
		case "mismatch":
			klasslist.push("match-miss");
			break;
		case "cancelled":
			klasslist.push("state-cancelled");
			break;
		case "tentative":
			klasslist.push("state-tentative");
			break;
		case "invalid":
			klasslist.push("nature-invalid");
			break;
	}
	const klasses = klasslist.length > 0 ? " " + klasslist.join(" ") : "";
	const fullHeadingId = args.kind === "calendar" && args.seq ? ` id="${idFor(args.seq, "heading")}"` : "";
	const tag = args.kind !== "calendar" && args.meeting.id ? ` id="${String(args.meeting.tag)}"` : "";
	const vitals = args.kind !== "calendar" ? `<p><i>${htmlEscapeThatNeedsImproving(args.meeting.title)}</i> <span>from: ${args.meeting.issueUrl ? repoFromIssueUrl(args.meeting.issueUrl) ?? UNKNOWN_PROPERTY : UNKNOWN_PROPERTY}</span></p>` : "";
	return `<div${tag} class="meeting${klasses}">
		<hgroup>
			<h${String(args.headingLevel)}${fullHeadingId}>${htmlEscapeThatNeedsImproving(args.meeting.calendarTitle)}</h${String(args.headingLevel)}>
			${vitals}
		</hgroup>
		<dl>
			<dt>Kind</dt><dd>${args.meeting.kind ? kindPretty[args.meeting.kind] : UNKNOWN_PROPERTY}</dd>
			<dt>Status</dt><dd>${args.meeting.status ? statusPretty[args.meeting.status] : UNKNOWN_PROPERTY}</dd>`;
}
function meetingCard(args) {
	let out = "";
	let tail = "";
	if (args.kind === "calendar") {
		const { meeting, headingLevel, repos } = args;
		if (meeting.status !== "cancelled") {
			const seq = headingCounter++;
			out += meetingCardHeader({
				kind: "calendar",
				meeting,
				headingLevel,
				seq
			});
			tail = newIssueForm(repos, seq);
		} else out += meetingCardHeader({
			kind: "calendar",
			meeting,
			headingLevel
		});
	} else {
		const { meeting, headingLevel } = args;
		out += meetingCardHeader({
			kind: "meeting",
			meeting,
			headingLevel
		});
	}
	if (args.kind !== "calendar" && args.meeting.match === "mismatch" && args.meeting.day !== args.meeting.calendarDay) {
		out += `<dt>Calendar day</dt><dd>${pretty(args.meeting.calendarDay)}</dd>`;
		out += `<dt>Our day</dt><dd>${pretty(args.meeting.day)}</dd>`;
	} else out += `<dt>Day</dt><dd>${pretty(args.meeting.calendarDay)}</dd>`;
	if (args.kind !== "calendar" && args.meeting.match !== "exact") {
		out += `<dt>Calendar time</dt><dd>${dtf(args.meeting.calendarStart)}&ndash;${dtf(args.meeting.calendarEnd)}</dd>`;
		out += `<dt>Our time</dt><dd>${dtf(args.meeting.start)}&ndash;${dtf(args.meeting.end)}</dd>`;
	} else out += `<dt>Time</dt><dd>${dtf(args.meeting.calendarStart)}&ndash;${dtf(args.meeting.calendarEnd)}</dd>`;
	out += `<dt>Room</dt><dd>${args.meeting.room ?? UNKNOWN_PROPERTY}</dd>`;
	if (args.kind === "meeting" && args.meeting.names) out += `<dt>People</dt><dd>${people(args.meeting.names, args.equivalents)}</dd>`;
	out += `<dt>Calendar URL</dt><dd><a href="${args.meeting.calendarUrl ?? UNKNOWN_PROPERTY}">${args.meeting.calendarUrl ?? UNKNOWN_PROPERTY}</a></dd>`;
	if ("issueUrl" in args.meeting) out += `<dt>Our issue URL</dt><dd><a href="${args.meeting.issueUrl ?? UNKNOWN_PROPERTY}">${args.meeting.issueUrl ?? UNKNOWN_PROPERTY}</a></dd>`;
	if (args.kind !== "calendar" && args.meeting.match) out += `<dt>Time match</dt><dd>${matchPretty[args.meeting.match]}</dd>`;
	if (args.kind !== "calendar" && (args.meeting.alternatives?.length ?? 0) > 0) out += `<dt>Alternatives</dt><dd>${prettyAlts(args.meeting)}</dd>`;
	out += "</dl>";
	if (args.kind !== "calendar") out += notes(args.meeting);
	return out + tail + "</div>";
}
function newIssueForm(repos, seq) {
	const SEP = " :: ";
	const buttonId = idFor(seq, "button");
	const repoId = idFor(seq, "repo");
	return `
		<form>
			<p>
				<label id="${repoId}">Repo: <select>${repos.reduce((out, [repo, label]) => out + `<option data-repo="${repo}" data-label="${label}">${repo}${SEP}${label.length ? label : "(no label)"}</option>`, "")}</select></label>
			</p>
			<button id="${buttonId}"
			  aria-labelledby="${buttonId} ${idFor(seq, "heading")}"
			  aria-describedby="${repoId}">Plan to attend</button>
		</form>`;
}
function clashingMeetings(pcm, kind, combined) {
	let html = "";
	for (const [name, cms] of pcm) if (cms.size) {
		html += `<section data-person="${name}">`;
		html += `<h4>${kind} clashing meetings for ${name}</h4><ol class="clashing">`;
		for (const [m, o] of cms) html += `<li>
					<p>${inlineSummary(m, true, combined, name)}</p>${alternativesOrNot(m)}
					<p>and</p>
					<p>${inlineSummary(o, true, combined, name)}</p>${alternativesOrNot(o)}</li>`;
		html += "</ol>";
		html += "</section>";
	}
	return html;
}
function possibleDuplicates(rdm, combined) {
	let html = "";
	for (const [repo, possibleDupes] of rdm) {
		html += `<h4>Possibly duplicate meetings in ${repo}</h4>`;
		for (const [index, meetings] of possibleDupes.entries()) {
			html += `<p>Set of possible duplicates ${String(index + 1)}:</p>`;
			html += "<ul>";
			for (const m of meetings) html += `<li><p>${inlineSummary(m, true, combined)}</p></li>`;
			html += "</ul>";
		}
	}
	return html;
}
function unassignedList(unassigned, combined) {
	let html = "";
	html += "<ul>";
	for (const meeting of unassigned) html += `<li><p>${inlineSummary(meeting, true, combined)}</p></li>`;
	html += "</ul>";
	return html;
}
function notes(meeting) {
	if (meeting.notes) return `<details>
			<summary>Meeting notes</summary>
			<pre>${meeting.notes}</pre>
		</details>`;
	return "";
}
function people(names, combined) {
	return names.map((name) => combined.has(name) ? combined.get(name) + " (" + name + ")" : name).join(", ");
}
function dtf(pdt) {
	return pdt ? pdt.toLocaleString(void 0, {
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit"
	}) : UNKNOWN_PROPERTY;
}
function pretty(thing) {
	return thing ? thing.charAt(0).toUpperCase() + thing.slice(1) : UNKNOWN_PROPERTY;
}
function prettyAlts(m) {
	return m.alternatives.length > 0 ? m.alternatives.join(", ") : "(none)";
}
function alternativesOrNot(m) {
	if (m.alternatives.length > 0) return `<p><strong>Possible alternative attendees:</strong> ${prettyAlts(m)}</p>`;
	return "";
}
function idFor(num, kind) {
	return `${kind}-${String(num)}`;
}
//#endregion
//#region src/meeting-from-issue.ts
let meetingCounter = 1;
function meetingFromIssue(dayInfo, getter, issue) {
	const bodyInfo = parseBodyInfo(dayInfo, issue.body);
	bodyInfo.extraPeople ??= [];
	const names = issue.assignees.map((assignee) => assignee.login);
	const id = URL.parse(bodyInfo.calendarUrl?.replace(/\/$/, "") ?? "")?.pathname.split("/").at(-1);
	const calendarInfo = getter(id ?? "");
	const match = calendarInfo.kind !== "nonexistent" ? bodyInfo.start && bodyInfo.end ? timeMatch(calendarInfo.calendarStart, calendarInfo.calendarEnd, bodyInfo.start, bodyInfo.end) : void 0 : void 0;
	return {
		...calendarInfo,
		alternatives: [],
		day: bodyInfo.day,
		end: bodyInfo.end,
		id,
		issueUrl: issue.url,
		kind: calendarInfo.kind,
		match,
		names: Array.from(/* @__PURE__ */ new Set([...names, ...bodyInfo.extraPeople])),
		notes: bodyInfo.notes,
		start: bodyInfo.start,
		tag: meetingCounter++,
		title: issue.title
	};
}
function parseBodyInfo(dayInfo, body) {
	const bodyLines = body.split(/\r?\n/);
	const calendarUrl = bodyLines.shift();
	const rawDay = bodyLines.shift()?.toLowerCase();
	const day = isDay(rawDay) ? rawDay : void 0;
	const startOfDay = day ? dayInfo[day].midnight : void 0;
	const time = bodyLines.shift();
	const startAndEnd = startOfDay ? time?.split(/ ?[–-] ?/).map((tstr) => timeStringToPlainDateTime(startOfDay, tstr)) : [];
	const start = startAndEnd?.[0];
	const end = startAndEnd?.[1];
	const extraPeopleOrBlank = bodyLines.shift();
	const haveExtraLine = extraPeopleOrBlank && extraPeopleOrBlank.length > 0;
	const extraPeople = haveExtraLine ? extraPeopleOrBlank.replaceAll(",", "").replaceAll("@", "").split(/\s/) : [];
	if (haveExtraLine) bodyLines.shift();
	return {
		calendarUrl,
		day,
		start,
		end,
		extraPeople,
		notes: bodyLines.join("\n")
	};
}
function timeStringToPlainDateTime(startOfDay, time) {
	const [hours, minutes] = time.split(":").map((s) => parseInt(s));
	return startOfDay.add(Temporal.Duration.from({
		hours,
		minutes
	}));
}
//#endregion
//#region src/clashing-meetings-set.ts
var ClashingMeetingsSet = class {
	#idPairs;
	#meetingPairs;
	constructor() {
		this.#idPairs = /* @__PURE__ */ new Set();
		this.#meetingPairs = [];
	}
	add(a, b) {
		const sorted = [a, b].sort((a, b) => a.tag - b.tag);
		if (sorted.length !== 2) throw new Error("Sorted pair is not of length 2: " + JSON.stringify(sorted));
		const ident = sorted.map((m) => m.tag).join(":");
		if (!this.#idPairs.has(ident)) {
			this.#idPairs.add(ident);
			this.#meetingPairs.push([sorted[0], sorted[1]]);
		}
	}
	get size() {
		return this.#meetingPairs.length;
	}
	[Symbol.iterator]() {
		return this.#meetingPairs[Symbol.iterator]();
	}
};
//#endregion
//#region src/scheduling.ts
function dayThings() {
	return new Map(days.map((day) => [day, []]));
}
function alternatives(possibleAlternatives, personDayGaps, meeting) {
	const out = [];
	for (const person of personDayGaps.keys()) {
		if (meeting.names.includes(person)) continue;
		if (possibleAlternatives.length > 0 && !possibleAlternatives.includes(person)) continue;
		for (const gap of personDayGaps.get(person)?.get(meeting.day) ?? []) if (isMeetingInGap(meeting, gap)) out.push(person);
	}
	return out;
}
function addMeeting(map, key, meeting) {
	if (map.has(key)) map.get(key).push(meeting);
	else map.set(key, [meeting]);
}
function addClashingMeeting(map, name, m, o) {
	if (!map.has(name)) map.set(name, new ClashingMeetingsSet());
	map.get(name).add(m, o);
}
function processSchedule(dayInfo, equivalents, alts, validMeetings) {
	const dayMeetings = dayThings();
	const personDayMeetings = /* @__PURE__ */ new Map();
	const personDayGaps = /* @__PURE__ */ new Map();
	const repoMeetings = /* @__PURE__ */ new Map();
	for (const meeting of validMeetings) {
		for (const name of meeting.names) {
			const normalisedName = equivalents.get(name) ?? name;
			if (!personDayMeetings.has(normalisedName)) personDayMeetings.set(normalisedName, dayThings());
			personDayMeetings.get(normalisedName)?.get(meeting.day)?.push(meeting);
			if (!personDayGaps.has(normalisedName)) personDayGaps.set(normalisedName, dayThings());
		}
		addMeeting(dayMeetings, meeting.calendarDay, meeting);
		addMeeting(repoMeetings, repoFromIssueUrl(meeting.issueUrl), meeting);
	}
	const peopleDefinitelyClashingMeetings = /* @__PURE__ */ new Map();
	const peopleNearlyClashingMeetings = /* @__PURE__ */ new Map();
	let haveDefinitelyClashing = false;
	let haveNearlyClashing = false;
	for (const [person, dayMeetings] of personDayMeetings) for (const [day, meetings] of dayMeetings) {
		const workingDay = dayInfo[day];
		let endOfLastMeeting = workingDay.start;
		for (const meeting of meetings) {
			for (const other of meetings) {
				if (meeting === other) continue;
				if (sameActualMeeting(meeting, other)) continue;
				switch (clashes(meeting, other)) {
					case "overlap":
						addClashingMeeting(peopleDefinitelyClashingMeetings, person, meeting, other);
						haveDefinitelyClashing = true;
						break;
					case "near":
						addClashingMeeting(peopleNearlyClashingMeetings, person, meeting, other);
						haveNearlyClashing = true;
						break;
				}
			}
			if (Temporal.PlainDateTime.compare(meeting.start, endOfLastMeeting) > 0) personDayGaps.get(person)?.get(day)?.push({
				start: endOfLastMeeting,
				end: meeting.start
			});
			if (Temporal.PlainDateTime.compare(meeting.end, endOfLastMeeting) > 0) endOfLastMeeting = meeting.end;
		}
		if (Temporal.PlainDateTime.compare(endOfLastMeeting, workingDay.end) < 0) personDayGaps.get(person)?.get(day)?.push({
			start: endOfLastMeeting,
			end: workingDay.end
		});
	}
	for (const meeting of validMeetings) meeting.alternatives.push(...alternatives(alts, personDayGaps, meeting));
	const repoPossibleDuplicates = /* @__PURE__ */ new Map();
	for (const [repo, meetings] of repoMeetings) {
		const grouped = Object.groupBy(meetings, (meeting) => meeting.calendarUrl);
		const possibleDupes = Object.values(grouped).filter((group) => group && group.length > 1);
		if (possibleDupes.length > 0) repoPossibleDuplicates.set(repo, possibleDupes.filter((v) => !!v));
	}
	return {
		repoPossibleDuplicates,
		peopleNearlyClashingMeetings,
		peopleDefinitelyClashingMeetings,
		personDayMeetings,
		dayMeetings,
		haveDefinitelyClashing,
		haveNearlyClashing,
		personDayGaps
	};
}
//#endregion
//#region src/query-issues.ts
function queryIssues(gh, repo, label) {
	const args = [
		"--repo",
		repo,
		"issue",
		"list",
		"--json",
		"assignees,body,title,url",
		"--limit",
		"999"
	];
	if (label) args.push("--label", label);
	console.log(gh, args.join(" "));
	const child = spawnSync(gh, args);
	if (child.error || child.stderr.length > 0) throw new Error(`gh: ${child.error?.message ?? child.stderr.toString()}`);
	try {
		return JSON.parse(child.stdout.toString());
	} catch (err) {
		throw new Error("Parsing GitHub API result: " + String(err instanceof Error ? err.message : err), { cause: err });
	}
}
//#endregion
//#region tsh.ts
const MY_NAME = "TPAC scheduling helper";
const MY_URL = "https://github.com/matatk/tpac-scheduling-helper";
const STYLE_FILE = path.join("static", "style.css");
const SCRIPT_FILE = path.join("static", "create-issue.js");
function errorOut(...args) {
	console.error(...args);
	process.exit(42);
}
function write(fileName, thingName, text) {
	fs.writeFileSync(fileName, text);
	console.log("Written", thingName, "to:", fileName);
}
function pathFromPackageRoot(partial) {
	let dir = import.meta.dirname;
	while (dir !== path.parse(dir).root) {
		if (fs.existsSync(path.join(dir, "package.json"))) return path.join(dir, partial);
		dir = path.dirname(dir);
	}
	throw new Error("Couldn't find static assets.");
}
function getIssues(gh, repos, queryResult) {
	const issues = [];
	if (queryResult) {
		console.log("Using existing query result:", queryResult);
		issues.push(...JSON.parse(fs.readFileSync(queryResult, "utf-8")));
	} else {
		console.log("Querying repo(s) with gh...");
		for (const [repo, label] of repos) try {
			issues.push(...queryIssues(gh, repo, label));
		} catch (err) {
			errorOut(err);
		}
	}
	if (issues.length === 0) console.error("No issues found");
	return issues;
}
function makeEquivalents(combine) {
	const equivalents = /* @__PURE__ */ new Map();
	if (combine) for (const [name, otherName] of combine) equivalents.set(name, otherName);
	return equivalents;
}
function generateMeetingList({ dayInfo, equivalents, issues, repos }) {
	return makeMeetingListPage({
		allMeetings: calendarMeetingsZipped(issues.reduce((acc, issue) => {
			const meeting = meetingFromIssue(dayInfo, calendarMeeting, issue);
			if (meeting.id) if (acc[meeting.id]) acc[meeting.id].push(meeting);
			else acc[meeting.id] = [meeting];
			return acc;
		}, {})),
		dayInfo,
		equivalents,
		myName: MY_NAME,
		myUrl: MY_URL,
		repos,
		script: pathFromPackageRoot(SCRIPT_FILE),
		style: pathFromPackageRoot(STYLE_FILE)
	});
}
function doScheduling({ alternatives, dayInfo, equivalents, issues }) {
	const { validMeetings, cancelledMeetings, movedMeetings, invalidMeetings, unassignedMeetings } = categoriseMeetings(issues.map(((issue) => meetingFromIssue(dayInfo, calendarMeeting, issue))));
	const { repoPossibleDuplicates, peopleNearlyClashingMeetings, peopleDefinitelyClashingMeetings, personDayMeetings, dayMeetings, haveDefinitelyClashing, haveNearlyClashing, personDayGaps } = processSchedule(dayInfo, equivalents, alternatives, validMeetings);
	return makeSchedulingPage({
		invalidMeetings,
		validMeetings,
		movedMeetings,
		repoPossibleDuplicates,
		unassignedMeetings,
		cancelledMeetings,
		peopleNearlyClashingMeetings,
		peopleDefinitelyClashingMeetings,
		personDayMeetings,
		equivalents,
		dayMeetings,
		haveDefinitelyClashing,
		haveNearlyClashing,
		personDayGaps,
		style: pathFromPackageRoot(STYLE_FILE),
		myName: MY_NAME,
		myUrl: MY_URL
	});
}
function getArgv() {
	return yargs(hideBin(process.argv)).parserConfiguration({ "flatten-duplicate-arrays": false }).options({
		calendar: {
			alias: "c",
			type: "string",
			description: "Path to the local meetings schedule ICS file. It will be downloaded from w3.org (according to the --year option's value) if it doesn't exist.\n",
			required: true
		},
		"output-plan": {
			alias: "p",
			type: "string",
			description: "Path to a local HTML file to create (or overwrite) with info on all TPAC meetings, so you can decide which to attend.\n"
		},
		"output-schedule": {
			alias: "s",
			type: "string",
			description: "Path to a local HTML file to create (or overwrite) with info on your planned meetings, and possible clashes.\n"
		},
		year: {
			alias: "y",
			choices: tpacYears,
			description: "Which TPAC year to use (defaults to the latest year).\n",
			default: tpacYears.at(-1)
		},
		repo: {
			alias: "r",
			type: "string",
			array: true,
			description: "GitHub repo(s) containing TPAC meeting-planning issues. By default, the same label will be applied to all repo searches. If you want to use different labels for some repos, you can specify the label to use after the repo shortname/URL.\n\n(Not required if you are using the --query-results debugging option.)\n"
		},
		label: {
			alias: "l",
			type: "string",
			description: "GitHub issue label to indicate TPAC meeting-planning issues. Can be overridden per repo, via the --repo option"
		},
		"query-result": {
			alias: "q",
			type: "string",
			description: "Path to local JSON file that contains issues returned in GitHub API query responses. Overrides --repo.\n"
		},
		"save-result": {
			alias: "S",
			type: "string",
			description: "Path to local JSON file to save all issues returned from all GitHub API query responses.\n"
		},
		gh: {
			type: "string",
			description: "Path to/name of gh binary.\n",
			default: "gh"
		},
		alternatives: {
			alias: "a",
			type: "string",
			array: true,
			description: "People (rather, their GitHub login names) who you want to consider as possible alternatives to attend meetings in the event of clashes. By default, all people referenced by the found issues will be considered as possible alternative meeting attendees.\n\nYou might want to use this if you run the tool from the perspective of different groups, e.g. a WG, or those of your colleagues who are attending TPAC.\n"
		},
		combine: {
			alias: "C",
			type: "string",
			array: true,
			description: "Pairs of GitHub usernames to consider equivalent. Useful for if you are querying across public and enterprise GitHub instances. The first name in the pair will be overridden by the second.\n"
		}
	}).coerce("repo", (repo) => {
		if (Array.isArray(repo) && repo.length <= 2 && repo.every((value) => typeof value === "string")) return [repo];
		return repo;
	}).coerce("alternatives", Array.prototype.flat).coerce("combine", (combine) => {
		if (Array.isArray(combine) && combine.length === 2 && combine.every((value) => typeof value === "string")) return [combine];
		return combine;
	}).check((args) => {
		for (const [one, other] of [["repo", "query-result"], ["output-plan", "output-schedule"]]) if (args[one] === void 0 && args[other] === void 0) throw new Error(`One of '--${one}' and '--${other}' must be supplied.`);
		return true;
	}).check((args) => {
		if (!args.repo) return true;
		if (!args.repo.every((value) => Array.isArray(value) && (value.length === 1 || value.length === 2))) errorOut("Every 'repo' option value must be either a GitHub repo, OR a GitHub repo and issue label to use when querying that repo. The values specified were:", args.repo);
		return true;
	}).check((args) => {
		args.alternatives ??= [];
		return true;
	}).check((args) => {
		if (!args.combine) return true;
		if (!args.combine.every((value) => Array.isArray(value) && value.length === 2)) errorOut("Every 'equivalent' option value must be a pair of two usernames to consider equal. The values specified were:", args.combine);
		return true;
	}).conflicts("query-result", "save-result").example("--repo w3c/apa-tpac-meetings", "Query the \"w3c/apa-tpac-meetings\" repo, fetching all issues, or those labelled as per the --label option.\n").example("--repo w3c/apa --repo w3c/aria", "Query multiple repos.\n").example("--repo w3c/apa tpac-2025 --repo w3c/aria", "Use a specific label for the \"w3c/apa\" repo.\n").example("--combine TopSecretAnna PublicAnna", "Any instance of TopSecretAnna will be considered as PublicAnna.\n").group([
		"calendar",
		"repo",
		"output-plan",
		"output-schedule"
	], "Vital info:").group([
		"label",
		"gh",
		"alternatives",
		"combine"
	], "Issue/filtering options:").group([
		"save-result",
		"query-result",
		"year"
	], "Testing and debugging options:").group(["help", "version"], "Workhorses:").strict().parseSync();
}
function main() {
	const argv = getArgv();
	const repos = argv.repo?.reduce((acc, cur) => {
		if (cur.length == 2) acc.push(cur);
		else acc.push([...cur, argv.label ?? ""]);
		return acc;
	}, []) ?? [];
	const tpac = TPACs[argv.year];
	const equivalents = makeEquivalents(argv.combine);
	const issues = getIssues(argv.gh, repos, argv.queryResult);
	calendarInit(tpac.icsUrl, argv.calendar);
	if (argv.outputPlan) write(argv.outputPlan, "meeting list", generateMeetingList({
		dayInfo: tpac.days,
		equivalents,
		issues,
		repos
	}));
	if (argv.outputSchedule) write(argv.outputSchedule, "scheduling info", doScheduling({
		alternatives: argv.alternatives ?? [],
		dayInfo: tpac.days,
		equivalents,
		issues
	}));
	if (argv.saveResult) write(argv.saveResult, "JSON returned via gh", JSON.stringify(issues, null, 2));
}
main();
//#endregion
export {};
