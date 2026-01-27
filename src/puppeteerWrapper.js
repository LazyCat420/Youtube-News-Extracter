const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// puppeteer.use(StealthPlugin());

const PuppeteerWrapper = {
    async searchYoutube(query) {
        console.log(`[Puppeteer] Searching YouTube for: ${query}`);
        let browser = null;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920,1080',
                ]
            });

            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            await page.goto(searchUrl, { waitUntil: 'networkidle2' });

            // Wait for results
            await page.waitForSelector('ytd-video-renderer', { timeout: 10000 });

            const videos = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('ytd-video-renderer'));
                return elements.map(el => {
                    const titleEl = el.querySelector('#video-title');
                    return {
                        title: titleEl ? titleEl.innerText.trim() : 'Unknown Title',
                        url: titleEl ? titleEl.href : null
                    };
                }).filter(v => v.url);
            });

            console.log(`[Puppeteer] Found ${videos.length} videos.`);
            await browser.close();
            return videos;

        } catch (error) {
            console.error('[Puppeteer] Search failed:', error.message);
            if (browser) await browser.close();
            return [];
        }
    },

    async scrapeURL(url) {
        console.log(`[Puppeteer] Starting scrape for: ${url}`);

        let libraryTranscript = null;
        try {
            const { YoutubeTranscript } = require('youtube-transcript');
            const items = await YoutubeTranscript.fetchTranscript(url);
            libraryTranscript = items.map(i => i.text).join(' ').replace(/\s+/g, ' ');
            console.log(`[Library] Successfully fetched transcript (${libraryTranscript.length} chars). Value: ${libraryTranscript.substring(0, 10)}...`);
        } catch (e) {
            console.log('[Library] Fetch failed, using Puppeteer fallback:', e.message);
        }

        let browser = null;
        let page = null;
        try {
            browser = await puppeteer.launch({
                headless: true, // Keep headless
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920,1080',
                    '--disable-blink-features=AutomationControlled'
                ]
            });

            page = await browser.newPage();

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920 + Math.floor(Math.random() * 100), height: 1080 + Math.floor(Math.random() * 100) });

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Humanize
            await page.mouse.move(100, 100);
            await new Promise(r => setTimeout(r, 1000));

            // Check unavailability
            const unavailable = await page.evaluate(() => {
                const h1 = document.querySelector('h1');
                return h1 && h1.innerText.includes("This video isn't available anymore");
            });
            if (unavailable) {
                console.error('[Puppeteer] Video unavailable.');
                await page.screenshot({ path: 'debug_blocked.png' });
                throw new Error('Video unavailable');
            }

            // Consent
            try {
                const consentSelector = 'button[aria-label="Accept all"], button[aria-label="Reject all"]';
                if (await page.$(consentSelector)) {
                    await page.click(consentSelector);
                    await new Promise(r => setTimeout(r, 2000));
                }
            } catch (e) { }

            await page.evaluate(() => window.scrollBy(0, 500));
            await new Promise(r => setTimeout(r, 1000));

            // 1. Metadata
            const titlePromise = page.$eval('h1.ytd-video-primary-info-renderer', el => el.innerText)
                .catch(() => page.title());

            // 2. Expand Description
            console.log('[Puppeteer] Expanding description...');
            let expanded = false;
            try {
                const validSelectors = [
                    '#description-inline-expander #expand',
                    'ytd-video-description-renderer #expand',
                    '#expand',
                    'tp-yt-paper-button#expand'
                ];

                for (const sel of validSelectors) {
                    if (await page.$(sel)) {
                        await page.click(sel);
                        expanded = true;
                        break;
                    }
                }

                if (!expanded) {
                    const jsClicked = await page.evaluate(() => {
                        const btn = document.querySelector('#expand');
                        if (btn) { btn.click(); return true; }
                        return false;
                    });
                    if (jsClicked) expanded = true;
                }

                if (expanded) await new Promise(r => setTimeout(r, 1000));

            } catch (e) {
                console.log('[Puppeteer] Error expanding description:', e.message);
            }


            let transcript = libraryTranscript || '';

            // ---------------------------------------------------------
            // NETWORK INTERCEPTION STRATEGY (Most Robust)
            // ---------------------------------------------------------
            // ---------------------------------------------------------
            // NETWORK INTERCEPTION STRATEGY (Most Robust)
            // ---------------------------------------------------------

            if (!transcript) {
                // 3. Click "Show transcript"
                console.log('[Puppeteer] Searching for "Show transcript"...');

                const transcriptBtn = await page.waitForSelector('xpath/.//button[contains(., "Show transcript")]', { visible: true, timeout: 5000 }).catch(() => null);

                if (transcriptBtn) {
                    console.log('[Puppeteer] Found button (Manual). Hovering and waiting to ensure API context...');
                    await page.hover('xpath/.//button[contains(., "Show transcript")]');
                    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

                    console.log('[Puppeteer] Clicking...');
                    // Create a Promise for the Network Interception
                    const networkPromise = new Promise(resolve => {
                        page.on('response', async response => {
                            const url = response.url();
                            if (url.includes('/get_transcript') || url.includes('/timedtext')) {
                                console.log(`[Puppeteer] Intercepted transcript endpoint: ${url}`);
                                try {
                                    const json = await response.json();
                                    console.log('[Puppeteer] Parsing intercepted JSON...');
                                    require('fs').writeFileSync('debug_transcript.json', JSON.stringify(json, null, 2));

                                    // Recursive finder
                                    const findSegments = (obj) => {
                                        let results = [];
                                        if (!obj || typeof obj !== 'object') return results;

                                        if (obj.transcriptSegmentRenderer) {
                                            results.push(obj.transcriptSegmentRenderer);
                                        }
                                        // Handle "timedtext" / "events" legacy format
                                        if (obj.segs && Array.isArray(obj.segs)) {
                                            obj.segs.forEach(s => {
                                                if (s.utf8) results.push({ snippet: { runs: [{ text: s.utf8 }] } }); // Normalize to match renderer structure
                                            });
                                        }

                                        for (const key in obj) {
                                            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                                                results = results.concat(findSegments(obj[key]));
                                            }
                                        }
                                        return results;
                                    };

                                    const segments = findSegments(json);
                                    if (segments && segments.length > 0) {
                                        const text = segments.map(s => {
                                            if (s.snippet && s.snippet.runs) {
                                                return s.snippet.runs.map(r => r.text).join('');
                                            }
                                            return '';
                                        }).join(' ');

                                        // HEURISTIC: Ads are usually short. Main transcripts are long.
                                        // Only resolve if length > 100 chars to avoid capturing pre-roll ads via "timedtext"
                                        if (text.length > 100) {
                                            console.log(`[Puppeteer] Intercepted ${text.length} chars via Network! Resolution triggered.`);
                                            resolve(text);
                                        } else {
                                            console.log(`[Puppeteer] Intercepted short text (${text.length} chars). Likely an Ad. Ignoring...`);
                                        }
                                    } else {
                                        console.log('[Puppeteer] Network recursive search found 0 segments keys.');
                                    }
                                } catch (e) { console.log('[Puppeteer] Network parsing failed:', e.message); }
                            }
                        });
                        // Timeout for network specifically
                        setTimeout(() => resolve(null), 15000);
                    });

                    // Trigger the network request by clicking
                    await page.evaluate(el => el.click(), transcriptBtn);
                    console.log('[Puppeteer] Clicked. Racing Network vs DOM...');

                    // DOM Promise
                    const domPromise = (async () => {
                        try {
                            console.log('[Puppeteer] Waiting for DOM elements...');
                            await page.waitForSelector('.segment-text, ytd-transcript-segment-renderer', { timeout: 15000 });

                            const text = await page.evaluate(() => {
                                const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer, .segment-text'));
                                const uniqueTexts = [];
                                segments.forEach(seg => {
                                    let t = '';
                                    if (seg.tagName.toLowerCase() === 'ytd-transcript-segment-renderer') {
                                        const el = seg.querySelector('.segment-text');
                                        t = el ? el.innerText.trim() : seg.innerText.trim();
                                    } else {
                                        t = seg.innerText.trim();
                                    }
                                    if (t && !uniqueTexts.includes(t)) uniqueTexts.push(t);
                                });
                                return uniqueTexts.join(' ').replace(/\s+/g, ' ');
                            });
                            if (text.length > 0) return text;
                        } catch (e) {
                            console.log('[Puppeteer] DOM wait timed out or failed.');
                        }
                        return null;
                    })();

                    // RACE THEM!
                    const result = await Promise.race([networkPromise, domPromise]);

                    if (result) {
                        transcript = result;
                        console.log(`[Puppeteer] Race won! Transcript extracted (${transcript.length} chars).`);
                    } else {
                        console.log('[Puppeteer] Race finished without result. Transcript unavailable.');
                    }

                } else {
                    console.log('[Puppeteer] "Show transcript" button NOT found.');
                    await page.screenshot({ path: 'debug_no_transcript_btn.png' });
                }
            }

            console.log(`[Puppeteer] Transcript extracted (${transcript.length} chars).`);

            const [title] = await Promise.all([titlePromise]);
            const description = await page.evaluate(() => {
                const el = document.querySelector('#description-inline-expander');
                return el ? el.innerText : '';
            });

            await browser.close();

            return {
                url,
                title,
                description,
                transcript
            };


        } catch (error) {
            console.error('[Puppeteer] Scrape failed:', error.message);
            if (page && !page.isClosed()) await page.screenshot({ path: 'debug_crash.png' });
            if (browser) await browser.close();
            throw error;
        }
    }
};

module.exports = PuppeteerWrapper;