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

export default function getIssues(repo: string, label: string): GhIssue[] {
	const cmd = 'gh'
	const args = [ '--repo', repo, 'issue', 'list', '--label', label, '--json', 'assignees,body,title,url', '--limit', '999' ]
	console.log(cmd, args.join(' '))
	const child = spawnSync(cmd, args)
	if (child.error || child.status !== 0) {
		throw new Error(`gh: ${child.stderr?.toString() ?? child.error?.message}`)
	}
	try {
		return JSON.parse(child.stdout.toString())
	} catch (err) {
		throw new Error('Parsing GitHub API result: ' + (err instanceof Error ? err.message : err)) // TODO: Should this be String(err)?
	}
}
