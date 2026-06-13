# TPAC scheduling helper

This tool is designed to help you plan a small group's attendance of [W3C TPAC](https://www.w3.org/news-events/tpac/).

The idea is that you file issues in a GitHub repo that correspond to meetings (or parts of meetings) that you would like to attend, and you can attach notes as to what you'd like to contribute etc. You can then run the tool every so-often to check...

* ...if the TPAC schedule has changed relative to your plans.

* ...whether you have any clashes between meetings you plan to attend. (The tool also checks for 'near clashes', which is where there are only small gaps between your planned meeting attendances.)

## Example use cases

* You are planning attendance within a W3C group, for the people from that group who are attending.

* You are planning attendance for a team from your organisation, where each person may be in one or more W3C groups.

## Prerequisites

The tool relies on the published TPAC schedule for a given year.

Technical dependencies are:

* Node

* `gh` - make sure you're logged in to any GitHub instances you want to query, including GitHub.com (you can check this with `gh auth status`)

* `curl` (if you want it to automatically download the schedule for you)

## Getting ready

1. Check out the repo.

2. `npm install`

3. `npm link` (this will put `tpac-scheduling-helper` on your path, so you can run it from anywhere)

## How to use

1. File issues in a GitHub repo according to the format outlined below. These issues tell the tool which meetings (or parts of meetings) you want to attend.

2. Run the script, which will:

   - Download the latest TPAC schedule (from the W3C Team) as an ICS file, or it will re-use an existing copy.
	
   - Check for scheduling conflicts, and for meetings that may have been moved.

   - Output an HTML file that covers your group's attendance, and provides warnings for individuals about potentially clashing meetings, plus a timetable for each person.

3. Repeat whenever you like.

> [!NOTE]
> The tool is capable of recognising the case where you plan to attend only _part_ of a meeting. However, the meeting's agenda in the calendar is a free text field, and may also link to other pages.
>
> Thus, the tool can't check whether a particular slot you plan to attend within a larger meeting has moved, so you'll need to check those cases manually. (The tool will, however, remind you of that.)

### Example usage

There's a repo containing some example (and test) TPAC planning issues. You can try out the tool on that repo by invoking it like this (on Unix-like OSes):

```sh
tpac-scheduling-helper \
	--repo matatk/tpac-scheduling-helper-test-issues-1 \
	--meetings schedule.ics \
	--output tpac.html
```

Use the `--help` option for a lot more info.

## GitHub issue format

You indicate which meetings you, or your group, wishes to attend by filing GitHub issues. You can file them in any repo, though you may find it neater to create a specific repo for TPAC meetings, or each year's TPAC meetings.

The **title** of the issue is used (but displayed with less prominence than the W3C Calendar title for the meeting).

The **body of the first comment on the issue thread** needs to match the following format:

```
<W3C Calendar URL for the meeting>
<day name (monday, tuesday, wednesday, thursday, friday)>
<start time (24-hour, HH:MM)> - <end time (24-hour, HH:MM)>
[optional list of GitHub usernames of additional attendees (see notes below!)]

[optional further lines containing your notes on the meeting]
```

Here's an example:

```
https://www.w3.org/events/meetings/31046de8-90b7-40f2-9b52-93d2fe0450b5/
Monday
13:45 - 15:00

* Recapping our plans for the week
* Upcoming internal work (review guide, FAST, ...)
* Planning the week in more details (incl. ARIA and MEIG & TTWG agenda)
* Any other business
```

Some notes on the formatting of the issue:

* **Issue title:** The tool displays the W3C Calendar meeting title most prominently, treating it as the single point of truth. However, the title you give to your planning issues is displayed (less prominently) too.

  You could use the title of your issue to provide a brief description of why you're attending that meeting (particularly applicable for when you are planning to attend a specific part of a meeting).

* **Day and time:** You need to specify both the day _and_ the time you plan to attend, so that the script can detect when a session has moved, or that you are planning to attend part of a meeting.

  The day name can be capitalised.

* **Time format:** The time should be in 24-hour format, with a colon (i.e. 'HH:MM').

  The bit between the start and end times can be either a plain hyphen or an en-dash and the spaces are optional.

  As noted above, you can specify that you only want to attend part of a meeting, but you'll need to check the agenda manually.

* **Optional additional attendees line:** You can only officially/semantically assign 10 people to a GitHub issue. If you need to indicate that more than 10 people will attend the meeting, you can add them to the issue comment, as indicated above. When doing this, the '@' symbols are optional.

  It's recommended that you use GitHub issue assignments wherever possible.

The tool will indicate in its output if it has encountered issues that don't match this format.

## Advanced usage

### Attending part(s) of meetings

You can file as many planning issues as you like, and they can cover the whole, or a part, of a given official TPAC meeting.

You can file multiple issues that reference the same calendared TPAC meeting (or parts thereof).

### Querying multiple repos

You can query across multiple GitHub repos in order to find scheduling issues. There are two ways to do this:

* Pass multiple `--repo` options, each giving a GitHub repo's shortname or URL. In this case, the default label (or that specified via `--label` will be used for the queries). For example:

	```sh
	tpac-scheduling-helper \
		--repo matatk/tpac-scheduling-helper \
		--repo w3c/apa
	```

* For each `--repo` option, pass both a repo (shortname or URL) _and_ label. This will override the default (or `--label`) issue label for querying that repo. For example:

	```sh
	tpac-scheduling-helper \
		--repo matatk/tpac-scheduling-helper tpac-2025 \
		--repo w3c/apa
	```

The script will warn you if you reference the same calendared TPAC meeting from multiple issues in the same repo, in case they're unintended duplicates. (It won't warn you if you reference the same TPAC meeting from multiple issues _across_ repos.)

### Combining GitHub usernames

If you are querying across public and enterprise GitHub instances, the same person may have different usernames. In this case, you can tell the tool to override one with the other, via the `--combine` option.

For example, passing `--combine TopSecretAnna PublicAnna` will instruct the tool to treat occurences of the username 'TopSecretAnna' as if they had been 'PublicAnna' all along. This ensures clashing meetings are correctly identified.

When a name is overridden, this is noted in the tool's output.

The look-up is only done once: attempting to override a name that was already overriding another name will not produce the desired results. However, it is possible to override multiple names with one other name.

### Specifying whom to consider as alternative meeting attendees

The tool will provide you with options for other people who may be free at the time of clashing meetings. The free/busy info is based only on other TPAC meetings people are assigned to, so will not be complete.

If you're doing scheduling for a small group, but are referring to meeting issues across multiple repos, you may want to limit the suggestions for alternative people to attend meetings. You can do this via the `--alternative` option, which takes a list of GitHub usernames.

## Future plans

* Further improvements in the output HTML.

* (Possibly) using the GitHub API directly.
