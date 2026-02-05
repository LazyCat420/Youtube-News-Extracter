const PuppeteerWrapper = require('./src/puppeteerWrapper');

async function reproduce() {
    console.log('--- REPRODUCTION SCRIPT START ---');
    const url = 'https://www.youtube.com/watch?v=fzsqpOuoASs';
    try {
        const data = await PuppeteerWrapper.scrapeURL(url);
        console.log('Scrape Result:', data.transcript ? `SUCCESS (${data.transcript.length} chars)` : 'FAILURE');
    } catch (e) {
        console.error('Scrape Exception:', e);
    }
    process.exit(0);
}

reproduce();
