export function repoFromIssueUrl(issueUrl: string): string | undefined {
	const from = issueUrl.startsWith('https://github.com/') ? -4 : 0
	const repo = issueUrl.split('/').slice(from, -2).join('/')
	return repo.length > 0 ? repo : undefined
}
