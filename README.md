# TPAC scheduling helper

This tool is designed to help you plan a small group's attendance of W3C TPAC 2025. The idea is that you can file issues in a GitHub repo that correspond to meetings (or parts of meetings) that you would like to attend, and you can attach notes as to what you'd like to contribute etc.

The tool can be run every so-often to check...

* ...if the TPAC schedule has changed relative to your plans.

* ...whether you have any clashes between meetings you plan to attend. It also checks for 'near clashes', which is where there's a 10-minute (or less) gap between your planned meeting attendances.

## Prerequisites

* Node

* `gh` - make sure you're logged in to any GitHub instances you want to query, including GitHub.com (you can check this with `gh auth status`)

* `curl` (if you want it to automatically download the schedule for you)

## Getting ready

1. Check out the repo.

2. `npm install`

## How to use

1. File issues in a GitHub repo according to the format outlined below.

2. Run the script. It will download the latest TPAC schedule as an HTML file - or re-use an existing copy. It will check for potentially moved meeting slots, and scheduling conflicts. Output will be printed in the terminal, and an HTML file will be written that presents the information in what may be a more usable way.

3. Repeat whenever you like.

**Limitations:** The tool is capable of recognising the case where you plan to attend only _part_ of a meeting, but as the meeting's agenda is a free text field, with no established format (or a link to some other URL), it can't check whether the particular slot within the larger meeting is still as you planned, so you'll need to check those things manually. (The tool will, however, remind you of that.)

### Example usage

To run it on _this_ repo (which contains some example TPAC planning issues), using the default issue label of 'tpac', you could invoke it like this (on Unix-like OSes):

```sh
./tsh.ts \
	--repo matatk/tpac-scheduling-helper \
	--meetings schedule-meetings.html \
	--output tpac.html
```

## GitHub issue format

The issue title will be displayed in the output, but less prominently than the W3C Calendar meeting title. This ensures everyone has a consistent name for the meeting. But you can use the issue title to emphasise, for example, the part of the meeting you want to attend.

The assignees are the people you would like to attend the meeting.

The body of the first comment on the issue needs to match the following format:

```
<W3C Calendar URL for the meeting>
<Day name>
<Start time> - <End time>

[optional further lines contain your notes on the meeting]
```

You need to specify the day _and_ time in the issue so that the script can detect when a session has moved.

The time should be in 24-hour format, with a colon (i.e. 'HH:MM').

The bit between the start and end times can be either a plain hyphen or an en-dash and the spaces are optional.

As noted above, you can specify that you only want to attend part of a meeting, but you'll need to check the agenda manually.

## Advanced usage

### Querying multiple repos

You can query across multiple GitHub repos in order to find scheduling issues. There are two ways to do this:

* Pass multiple `--repo` options, each giving a GitHub repo's shortname or URL. In this case, the default label (or that specified via `--label` will be used for the queries). For example:

	```sh
	./tsh.ts --repo matatk/tpac-scheduling-helper --repo w3c/apa ...
	```

* For each `--repo` option, pass both a repo (shortname or URL) _and_ label. This will override the default (or `--label`) issue label for querying that repo. For example:

	```sh
	./tsh.ts --repo matatk/tpac-scheduling-helper tpac-2025 --repo w3c/apa ...
	```

### Combining GitHub usernames

If you are querying across public and enterprise GitHub instances, the same person may have different usernames. In this case, you can tell the tool to override one with the other, via the `--combine` option.

For example, passing `--combine TopSecretAnna PublicAnna` will instruct the tool to treat occurences of the username 'TopSecretAnna' as if they had been 'PublicAnna' all along. This ensures clashing meetings are correctly identified.

When a name is overridden, this is noted in the tool's output.

The look-up is only done once: attempting to override a name that was already overriding another name will not produce the desired results. However, it is possible to override multiple names with one other name.

## Future plans

* Output improvements based on the experience of using it this year.

* Investigate wether there is/could be an API for querying the W3C Calendar - or at least a neater way to get the data.
