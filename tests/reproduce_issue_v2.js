const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function reproduce() {
    console.log('--- REPRODUCTION V2: DOM DUMP ---');
    const url = 'https://www.youtube.com/watch?v=N1bnfTPzZN8';

    // Launch browser with slightly more relaxed settings for debugging
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Wait longer and check for specific app element
        try {
            await page.waitForSelector('ytd-app', { timeout: 10000 });
        } catch (e) {
            console.log('Timeout waiting for ytd-app');
        }

        await page.screenshot({ path: 'debug_repro.png', fullPage: true });

        // Dump 1: Pre-expansion HTML of the description area (BROADER SCOPE)
        const descriptionHtml = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const primary = document.querySelector('#primary');
            return {
                primaryHTML: primary ? 'PRIMARY_FOUND' : 'PRIMARY_NOT_FOUND',
                bodyTextSummary: bodyText.substring(0, 500) // First 500 chars to check for "Sign in" or "Consent"
            };
        });

        // Specific Dump: The expand button candidates
        const buttonDump = await page.evaluate(() => {
            // Get ALL buttons to see what's there
            const els = Array.from(document.querySelectorAll('button, tp-yt-paper-button, #more, #expand'));
            return els.map(el => {
                return {
                    tag: el.tagName,
                    id: el.id,
                    text: el.innerText ? el.innerText.substring(0, 50) : '',
                };
            }).filter(d => d.text.toLowerCase().includes('more') || d.id === 'expand');
        });

        console.log('--- DUMP COMPLETE ---');
        console.log('Body Text Start:', descriptionHtml.bodyTextSummary);

        require('fs').writeFileSync('debug_dom_dump.json', JSON.stringify({ html: descriptionHtml, buttons: buttonDump }, null, 2));

        console.log('--- DESCRIPTION HTML DUMP ---');
        // console.log(descriptionHtml.substring(0, 2000)); // Log partially

        console.log('--- BUTTON CANDIDATES ---');
        console.log(JSON.stringify(buttonDump, null, 2));

        require('fs').writeFileSync('debug_dom_dump.json', JSON.stringify({ html: descriptionHtml, buttons: buttonDump }, null, 2));

    } catch (e) {
        console.error('Exception:', e);
    } finally {
        await browser.close();
    }
}

reproduce();
