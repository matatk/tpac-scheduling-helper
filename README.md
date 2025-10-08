# TPAC scheduling helper

This tool is designed to help you plan a small group's attendance of W3C TPAC 2025. The idea is that you can file issues in a GitHub repo that correspond to meetings (or parts of meetings) that you would like to attend, and you can attach notes as to what you'd like to contribute etc.

The tool can be run every so-often to check...

* ...if the TPAC schedule has changed relative to your plans.

* ...whether you have any clashes between meetings you plan to attend. It also checks for 'near clashes', which is where there's a 10-minute (or less) gap between your planned meeting attendances.

## Prerequisites

* Node

* `gh`

* `curl` (if you want it to automatically download the schedule for you)

## Installation

1. Check out the repo.

2. `npm install`

## How to use

1. File issues in a GitHub repo according to the format outlined below.

2. Run the script. It will download the latest TPAC schedule as an HTML file - or re-use an existing copy. It will check for potentially moved meeting slots, and scheduling conflicts. Output will be printed in the terminal, and an HTML file will be written that presents the information in what may be a more usable way.

3. Repeat whenever you like.

**Limitations:** The tool is capable of recognising the case where you plan to attend only _part_ of a meeting, but as the meeting's agenda is a free text field, with no established format, it can't check whether the particular slot within the larger meeting is still as you planned, so you'll need to check those things manually. (The tool will, however, remind you of that.)

## Example usage

To run it on _this_ repo (which contains some example TPAC planning issues), using the default issue label of 'tpac', you could invoke it like this (on Unix-like OSes):

```sh
./tsh.ts \
    --repo 'https://github.com/matatk/tpac-scheduling-helper' \
    --meetings schedule-meetings.html \
    --output tpac.html
```

## Issue format

The title you give to issues isn't so important (the meeting will be picked up from the TPAC schedule - so that we're all on the same page).

The assignees are the people you would like to attend the meeting.

The body of the first comment on the issue needs to match the following format:

```
<W3C Calendar URL for the meeting>
<Day name>
<Start time> - <End time>

[optional further lines contain your notes on the meeting]
```

The time should be in 24-hour format, with a colon (i.e. `HH:MM`). The bit between the times does need to be " - " exactly.

The reason you need to specify the day and time in the issue is so that there's a better chance the script can detect when a session has moved.

## Future plans

I plan to add support for referring to multiple repos to get the scheduling data - so if you're in multiple W3C groups, you could check that the schedule works _across all of your groups_.

Support for running across public and entirprise GitHub instances is also being worked on.
