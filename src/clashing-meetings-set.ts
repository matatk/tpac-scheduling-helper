import type { Meeting } from './meeting.ts'

export default class ClashingMeetingsSet {
	#idPairs: Set<string>
	#meetingPairs: [Meeting, Meeting][]

	constructor() {
		this.#idPairs = new Set()
		this.#meetingPairs = []
	}

	add(a: Meeting, b: Meeting) {
		const sorted = [ a, b ].sort((a, b) => a.tag - b.tag)
		if (sorted.length !== 2) throw('Sorted pair is not of length 2: ' + sorted)
		const ident = sorted.map(m => m.tag).join(':')
		if (!this.#idPairs.has(ident)) {
			this.#idPairs.add(ident)
			this.#meetingPairs.push([ sorted[0], sorted[1] ])
		}
	}

	get size() {
		return this.#meetingPairs.length
	}

	[Symbol.iterator]() {
		return this.#meetingPairs[Symbol.iterator]()
	}
}
