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

interface GhTeam {
	slug: string
}

function doIt(gh: string, args: string[], label?: string, processor?: (stdout: string) => string) {
	if (label) args.push('--label', label) // FIXME: do this in queryIssues instead
	console.log(gh, args.join(' '))
	const child = spawnSync(gh, args)
	if (child.error || child.stderr.length > 0) {
		throw new Error(`gh: ${child.error?.message ?? child.stderr.toString()}`)
	}
	try {
		const basic = child.stdout.toString().trim() // TODO: is there a neater way?
		return processor ? processor(basic) : basic
	} catch (err) {
		throw new Error('Parsing GitHub API result: ' + String(err instanceof Error ? err.message : err), { cause: err })
	}
}

export function queryIssues(gh: string, repo: string, label?: string): GhIssue[] {
	const args = [ '--repo', repo, 'issue', 'list', '--json', 'assignees,body,title,url,labels', '--limit', '999' ]
	return doIt(gh, args, label, JSON.parse) as unknown as GhIssue[]
}

export function getMembers(gh: string, org: string, repo: string, all: boolean) {
	let teams: string[]

	const getTeams = [ 'api', '--paginate', `repos/${org}/${repo}/teams` ]

	const jqScript = '[ .[].login ] | join(" ")'
	const getMembers = (team: string, quoteJq = false) => [
		'api', '--paginate', `orgs/${org}/teams/${team}/members`,
		'--jq', quoteJq ? `'${jqScript}'` : jqScript ]

	try {
		teams = (doIt(gh, getTeams, undefined, JSON.parse) as unknown as GhTeam[]).map(team => team.slug)
	} catch (err) {
		console.error('Unable to get teams list from GitHub API; you may not have permission.', err)
		return
	}
	console.log('Found teams', teams)
	const candidates = teams.filter(team => team.includes('members'))
	const likely = candidates.length === 1 ? candidates[0] : null
	if (all) {
		console.log('Getting members from all teams associated with the repo...')
		const allMembers: string[] = []
		for (const team of teams) {
			allMembers.push(...doIt(gh, getMembers(team)).split(' '))
		}
		console.log(`Found group members (all teams):\n\n${allMembers.sort().join(' ')}`)
	}	else if (likely) {
		console.log('Found expcted team of repo members:', likely, '\n')
		const members = doIt(gh, getMembers(likely)).split(' ').sort().join(' ')
		console.log(`Found group members:\n\n${members}`)
	} else {
		console.error(`Couldn't find a likely team of members for repo: ${repo}.`)
		console.log('You could try the following commands to list group members, if you have access...\n')
		for (const team of teams) {
			console.log(`${gh} ${getMembers(team, true).join(' ')}`)
		}
		console.log('\n...or, you could use the --all option to fetch all members from these teams.')
	}
}
