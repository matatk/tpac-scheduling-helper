#!/usr/bin/env node
import path from 'path'

import { chromium } from 'playwright'
import sharp from 'sharp'

interface Dims { width: number, height: number }

const outputSize = { width: 1920, height: 1080 }
const viewportSize = multiDims(1.45, outputSize)

function multiDims(factor: number, { width, height }: Dims): Dims {
	return { width: width * factor, height: height * factor }
}

async function capture(relPath: string, outputPart: string, scrollDown?: boolean): Promise<void> {
	const browser = await chromium.launch({ headless: true })
	const page = await browser.newPage()

	for (const mode of [ 'dark', 'light' ] as const) {
		try {
			await page.emulateMedia({ colorScheme: mode })

			const url = 'file://' + path.join(import.meta.dirname, relPath)
			await page.goto(url, { waitUntil: 'networkidle' })

			await page.setViewportSize(viewportSize)

			if (scrollDown) await page.evaluate(
				() => window.scrollTo(0, document.body.scrollHeight))

			const buffer = await page.screenshot({ fullPage: false })

			const outputPath = path.join(import.meta.dirname, `${outputPart}-${mode}.png`)
		  await sharp(buffer)
		    .resize(outputSize)
		    .toFile(outputPath)

			console.log(`Screenshot saved to: ${outputPath}`)
		} catch (error) {
			console.error('Failed to capture page:', error)
		}
	}

	await browser.close()
}

await capture('../cache/tpac-2026-list.html', 'planning')
await capture('../cache/tpac-2026-scheduling.html', 'scheduling', true)
