const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');

async function diagnose() {
    const url = 'https://www.youtube.com/watch?v=fzsqpOuoASs';
    console.log(`[Diagnostic] Starting for: ${url}`);

    const browser = await puppeteer.launch({
        headless: true, // Headless for consistency with failure env
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('[Diagnostic] Checking for ads...');
        const adElement = await page.waitForSelector('.ad-showing, .video-ads, .ytp-ad-module', { timeout: 10000 }).catch(() => null);

        if (adElement) {
            console.log('[Diagnostic] Ad detected! Dumping details...');

            // 1. Screenshot
            await page.screenshot({ path: 'diagnose_ad_state.png' });

            // 2. Dump HTML of ad container
            const adHtml = await page.evaluate(() => {
                const player = document.querySelector('#movie_player');
                const adModule = document.querySelector('.ytp-ad-module');
                return {
                    playerClasses: player ? player.className : 'N/A',
                    adModuleHTML: adModule ? adModule.outerHTML : 'N/A',
                    allButtons: Array.from(document.querySelectorAll('button')).map(b => ({
                        text: b.innerText,
                        class: b.className,
                        id: b.id
                    }))
                };
            });

            fs.writeFileSync('diagnose_ad_dump.json', JSON.stringify(adHtml, null, 2));
            console.log('[Diagnostic] Saved diagnose_ad_state.png and diagnose_ad_dump.json');
        } else {
            console.log('[Diagnostic] No ad detected during this run.');
        }

    } catch (e) {
        console.error('[Diagnostic] Error:', e);
    } finally {
        await browser.close();
    }
}

diagnose();
