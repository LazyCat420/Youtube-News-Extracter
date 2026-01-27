require('dotenv/config');
const puppeteer = require('puppeteer');
const xml2js = require('xml2js');

// Helper for dates
const UtilityLibrary = {
    getCurrentDateAndTime: (date) => new Date(date).toLocaleString(),
    getMinutesAgo: (date) => Math.floor((new Date() - new Date(date)) / 60000)
};

let puppeteerOptions = {
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};

if (process.platform === "linux") {
    // Adjust if necessary for your environment
    puppeteerOptions.executablePath = '/usr/bin/chromium-browser'; 
}

const PuppeteerWrapper = {
    async scrapeRSS(url) {
        const browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });

        let xmlContent = await page.evaluate(() => document.body.innerText);
    
        await browser.close();

        xmlContent = xmlContent.substring(xmlContent.indexOf('<rss'));
        xmlContent = xmlContent.replace(/&(?!nbsp;)/g, '&amp;');
    
        const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(xmlContent);
        const items = result.rss.channel.item;
        return items;
    },

    async searchYoutube(query) {
        const browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        
        console.log(`Searching YouTube for: ${query}`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Scroll a bit to load more items
        await page.evaluate(async () => {
            window.scrollBy(0, 500);
        });

        // Extract video IDs and titles
        const videos = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('ytd-video-renderer'));
            return items.map(item => {
                const titleEl = item.querySelector('#video-title');
                const linkEl = item.querySelector('#video-title');
                return {
                    title: titleEl ? titleEl.innerText : null,
                    url: linkEl ? linkEl.href : null,
                    videoId: linkEl && linkEl.href ? linkEl.href.split('v=')[1]?.split('&')[0] : null
                };
            }).filter(v => v.videoId);
        });

        await browser.close();
        return videos;
    },

    async scrapeURL(url) {
        console.log(`Scraping URL: ${url}`);
        const browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();
        const result = { url };

        try {
            await page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 60000 
            });

            // Basic Metadata
            result.title = await page.title();
            
            // Attempt to get description
            try {
                // Click "more" button in description if present
                const moreButton = await page.$('#expand');
                if (moreButton) await moreButton.click();
                await new Promise(r => setTimeout(r, 1000)); // wait for expansion
                
                const descEl = await page.$('#description-inline-expander');
                if (descEl) {
                    result.description = await page.evaluate(el => el.innerText, descEl);
                }
            } catch (e) {
                console.log('Could not expand/find description');
            }

            // Transcript Extraction
            try {
                // Note: The selector for the transcript button often changes or is inside a menu
                // This is a best-effort approach based on the user's snippet
                
                // Sometimes it's in the "..." menu
                const menuButton = await page.$('button[aria-label="More actions"]');
                if (menuButton) await menuButton.click();
                
                // Look for "Show transcript" button
                const showTranscriptButton = await page.$x("//button[contains(., 'Show transcript')]");
                if (showTranscriptButton.length > 0) {
                    await showTranscriptButton[0].click();
                    
                    await page.waitForSelector('ytd-transcript-segment-renderer', { timeout: 5000 });
            
                    const transcriptData = await page.evaluate(() => {
                        const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
                        return segments.map(segment => {
                            const timestamp = segment.querySelector('.segment-timestamp')?.innerText || '';
                            const text = segment.querySelector('.segment-text')?.innerText || '';
                            return { timestamp, text };
                        });
                    });
                    
                    result.transcript = transcriptData.map(entry => `${entry.timestamp}: ${entry.text}`).join('\n');
                } else {
                    console.log('Transcript button not found');
                }
            } catch (error) {
                console.log('Transcript extraction failed:', error.message);
            }

        } catch (error) {
            console.error(`Failed to scrape URL ${url}:`, error.message);
        } finally {
            await browser.close();
        }
        
        return result;
    }
};

module.exports = PuppeteerWrapper;