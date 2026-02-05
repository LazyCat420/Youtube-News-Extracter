const PuppeteerWrapper = require('./src/puppeteerWrapper');

async function verify() {
    // Rick Astley - Never Gonna Give You Up (Always available, has manual captions)
    // Using a reliable video to rule out "video not available" issues
    // Video that failed for the user: The Government SHUTDOWN Is About To Make The Stock Market Go Crazy
    const testUrl = 'https://www.youtube.com/watch?v=4LyDMYJpR6s';

    console.log(`Testing scraper with URL: ${testUrl}`);

    try {
        const start = Date.now();
        const result = await PuppeteerWrapper.scrapeURL(testUrl);
        const duration = (Date.now() - start) / 1000;

        console.log('--- Result ---');
        console.log(`Duration: ${duration}s`);

        if (!result) {
            console.error('Result is null!');
            return;
        }

        console.log(`Title: ${result.title}`);
        console.log(`Description length: ${result.description?.length || 0}`);

        if (result.transcript) {
            console.log(`Transcript found! Length: ${result.transcript.length} chars`);
            console.log('Snippet:', result.transcript.substring(0, 200) + '...');
        } else {
            console.error('FAILED: No transcript extracted.');
            console.log('Check debug screenshots.');
        }

    } catch (error) {
        console.error('Verification failed with error:', error);
    }
}

verify();
