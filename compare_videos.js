const PuppeteerWrapper = require('./src/puppeteerWrapper');

async function compare() {
    console.log('--- COMPARISON STARTED ---');

    const videos = [
        'https://www.youtube.com/watch?v=4LyDMYJpR6s', // FAIL
        'https://www.youtube.com/watch?v=fzsqpOuoASs'  // SUCCESS
    ];

    for (const url of videos) {
        console.log(`\n\nTesting: ${url}`);
        try {
            const data = await PuppeteerWrapper.scrapeURL(url);
            console.log(`Result: ${data.transcript ? 'SUCCESS (' + data.transcript.length + ' chars)' : 'FAILURE'}`);
        } catch (e) {
            console.error('Exception:', e.message);
        }
    }
    process.exit(0);
}

compare();
