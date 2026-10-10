import { spawnSync } from 'child_process'

export interface GhIssue {
	assignees: GhAssignee[]
	body: string
	title: string
	url: string
	labels: GhLabel[]
}

interface GhAssignee {
	id: string
	login: string
	name: string
	databaseId: number
}

interface GhLabel {
	id: string
	name: string
	description: string
	color: string
}

function doIt(verbose: boolean, gh: string, args: string[], label?: string, processor?: (stdout: string) => string) {
	if (label) args.push('--label', label)
	if (verbose) console.log(gh, args.join(' '))
	const child = spawnSync(gh, args)
	if (child.error || child.stderr.length > 0) {
		throw new Error(`gh: ${child.error?.message ?? child.stderr.toString()}`)
	}
	try {
		if (processor) {
			return processor(child.stdout.toString())
		} else {
			return child.stdout.toString()
		}
	} catch (err) {
		throw new Error('Parsing GitHub API result: ' + String(err instanceof Error ? err.message : err), { cause: err })
	}
}

export function queryIssues(gh: string, repo: string, label?: string): GhIssue[] {
	const args = [ '--repo', repo, 'issue', 'list', '--json', 'assignees,body,title,url,labels', '--limit', '999' ]
	return doIt(true, gh, args, label, JSON.parse) as unknown as GhIssue[]
}

export function getCollaborators(gh: string, repo: string): string {
	const args = [ 'api', `repos/${repo}/collaborators`, '--jq', '[ .[].login ] | join(" ")' ]
	return doIt(false, gh, args)
}
