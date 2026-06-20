import { spawnSync } from 'child_process'

export interface GhIssue {
	assignees: GhAssignee[]
	body: string
	title: string
	url: string
}

interface GhAssignee {
	id: string
	login: string
	name: string
	databaseId: number
}

export default function queryIssues(gh: string, repo: string, label: string): GhIssue[] {
	const args = [ '--repo', repo, 'issue', 'list', '--label', label, '--json', 'assignees,body,title,url', '--limit', '999' ]
	console.log(gh, args.join(' '))
	const child = spawnSync(gh, args)
	if (child.error || child.stderr.length > 0) {
		throw new Error(`gh: ${child.error?.message ?? child.stderr.toString()}`)
	}
	try {
		return JSON.parse(child.stdout.toString())
	} catch (err) {
		throw new Error('Parsing GitHub API result: ' + String(err instanceof Error ? err.message : err), { cause: err })
	}
}
