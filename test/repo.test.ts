import { describe, expect, test } from 'vitest'

import { repoFromIssueUrl } from '../src/repo'

describe('Getting repo from issue URL', () => {
	test('An invaldi URL', () => {
		expect(repoFromIssueUrl('moo')).toBe(undefined)
	})

	test('A GitHub URL', () => {
		expect(repoFromIssueUrl('https://github.com/w3c/apa/issues/42')).toBe('w3c/apa')
	})

	test('A URL from a different GitHub instance', () => {
		expect(repoFromIssueUrl('https://my.cool.gh.instance.org/w3c/apa/issues/42')).toBe('w3c/apa')
	})
})
