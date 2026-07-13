function createNewIssue(event) {
	event.preventDefault()
	const selectedOption = event.currentTarget.form.querySelector('select').selectedOptions[0]
	const repo = selectedOption.dataset.repo
	const label = selectedOption.dataset.label

	const title = encodeURIComponent(event.currentTarget.form.parentElement.firstElementChild.firstElementChild.innerText)

	const dl = event.currentTarget.form.previousElementSibling
	const calendarUrl = dl.children[11].innerText
	const day = dl.children[7].innerText
	const times = dl.children[9].innerText
	const body = encodeURIComponent([calendarUrl, day, times].join('\n'))

	const labelParam = label ? `&labels=${label}` : ''
	const request = repo.includes('https')
		? `${repo}/issues/new?title=${title}&body=${body}${labelParam}`
		: `https://www.github.com/${repo}/issues/new?title=${title}&body=${body}${labelParam}`

	window.open(request)
}

for (const button of document.getElementsByTagName('button')) {
	button.addEventListener('click', createNewIssue)
}
