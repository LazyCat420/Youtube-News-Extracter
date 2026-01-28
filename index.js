require('dotenv/config');
const PuppeteerWrapper = require('./src/puppeteerWrapper');
const Database = require('./src/database');

const SEARCH_QUERY = process.env.SEARCH_QUERY || 'Stock Market News Today';
const MAX_VIDEOS = 3;

async function main() {
    console.log(`🚀 Starting Youtube News Extracter...`);
    console.log(`🔍 Searching for: "${SEARCH_QUERY}"`);

    try {
        // 1. Search YouTube
        const videos = await PuppeteerWrapper.searchYoutube(SEARCH_QUERY);
        console.log(`Found ${videos.length} videos.`);

        // 2. Process first few videos
        for (const video of videos.slice(0, MAX_VIDEOS)) {
            console.log(`\n📺 Processing: ${video.title}`);

            // Check if already in DB (optimization: check DB before scraping)
            // For now we just scrape and let DB ignore duplicates

            const scrapedData = await PuppeteerWrapper.scrapeURL(video.url);

            if (scrapedData && scrapedData.transcript) {
                console.log(`✅ Transcript found (${scrapedData.transcript.length} chars).`);

                // 3. Save to Database
                const videoId = await Database.saveVideo({
                    title: video.title,
                    url: video.url,
                    description: scrapedData.description,
                    transcript: scrapedData.transcript
                });

            } else {
                console.log('❌ No transcript available for this video.');
            }
        }

    } catch (error) {
        console.error('Fatal Error:', error);
    } finally {
        // Database.close(); // Keep open if running as server, close if script
    }
}

main();