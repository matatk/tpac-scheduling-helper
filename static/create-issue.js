// FIXME: Doesn't work with private GitHub instances
// FIXME: Need to know label for GitHub issue
function createNewIssue(event) {
	event.preventDefault()
	const repo = event.currentTarget.form.querySelector('select').value

	const title = encodeURIComponent(event.currentTarget.form.parentElement.firstElementChild.firstElementChild.innerText)

	const dl = event.currentTarget.form.previousElementSibling
	const calendarUrl = dl.children[11].innerText
	const day = dl.children[7].innerText
	const times = dl.children[9].innerText
	const body = encodeURIComponent([calendarUrl, day, times].join('\n'))

	const request = `https://www.github.com/${repo}/issues/new?title=${title}&body=${body}`
	window.open(request)
}

for (const button of document.getElementsByTagName('button')) {
	button.addEventListener('click', createNewIssue)
}
