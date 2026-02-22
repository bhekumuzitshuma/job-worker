import { startPolling } from './poller.js'
import { runDailyScrape } from './tasks/scrapeJobs.js'

console.log("Worker started...")
startPolling()

// Background scraper loop: runs `runDailyScrape` periodically while process is alive.
const SCRAPE_INTERVAL_MS = process.env.SCRAPE_INTERVAL_MS
	? parseInt(process.env.SCRAPE_INTERVAL_MS, 10)
	: 1000 * 60 * 60 // default: 1 hour

let scraperRunning = false

async function startScraperLoop() {
	console.log('Background scraper loop starting. Interval:', SCRAPE_INTERVAL_MS, 'ms')
	while (true) {
		try {
			if (!scraperRunning) {
				scraperRunning = true
				await runDailyScrape()
			} else {
				console.log('Scraper already running; skipping this interval.')
			}
		} catch (err) {
			console.error('Background scraper error:', err)
		} finally {
			scraperRunning = false
		}

		await new Promise((resolve) => setTimeout(resolve, SCRAPE_INTERVAL_MS))
	}
}

// Start loop without awaiting so it runs in background alongside polling
startScraperLoop().catch((e) => console.error('Scraper loop failed:', e))
