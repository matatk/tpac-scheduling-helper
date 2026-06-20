export function repoFromIssueUrl(issueUrl: string): string | undefined {
	const repo = issueUrl.split('/').slice(-4, -2).join('/')
	return repo.length > 0 ? repo : undefined
}
