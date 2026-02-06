const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// NOTE: AdblockerPlugin DISABLED - it blocks YouTube's internal API scripts
// which causes FAILED_PRECONDITION errors on /get_transcript requests
// const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
// puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// Helper: Skip ads manually if present
async function handleAds(page) {
    const maxAttempts = 15;
    for (let i = 0; i < maxAttempts; i++) {
        const adShowing = await page.evaluate(() => {
            return document.querySelector('.ad-showing') !== null ||
                document.querySelector('.ytp-ad-player-overlay') !== null;
        });

        if (!adShowing) {
            console.log('[Puppeteer] No ads detected or ads finished.');
            return;
        }

        console.log(`[Puppeteer] Ad detected. Attempt ${i + 1}/${maxAttempts} to skip...`);

        // Try to click skip button
        try {
            const skipBtn = await page.$('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
            if (skipBtn) {
                await skipBtn.click();
                console.log('[Puppeteer] Clicked skip ad button.');
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
        } catch (e) { }

        // Wait a bit before next check
        await new Promise(r => setTimeout(r, 2000));
    }
    console.log('[Puppeteer] Ad handling completed (timeout or skipped).');
}

// Helper: Expand description/Show more
async function expandDescription(page) {
    console.log('[Puppeteer] Expanding description to reveal transcript button...');
    let expanded = false;

    // Helper to check if description is expanded
    const isExpanded = async () => {
        return await page.evaluate(() => {
            const expander = document.querySelector('#description-inline-expander');
            return expander && expander.hasAttribute('is-expanded');
        });
    };

    // Strategy A: ID/Selector based clicks
    const expandSelectors = [
        '#description-inline-expander #expand',
        '#expand',
        'tp-yt-paper-button#expand',
        '#more',
        'button[aria-label="Show more"]',
        '#meta-contents #expand',
        'ytd-text-inline-expander #expand'
    ];

    for (const sel of expandSelectors) {
        if (await isExpanded()) { expanded = true; break; }
        try {
            const btn = await page.$(sel);
            if (btn) {
                console.log(`[Puppeteer] Clicking expand button: ${sel}`);
                // Scroll to button first
                await btn.scrollIntoViewIfNeeded();
                await new Promise(r => setTimeout(r, 500));
                await btn.click();
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (e) { }
    }

    // Strategy B: Text-based (Recursive Finder) for "...more"
    if (!expanded && !(await isExpanded())) {
        console.log('[Puppeteer] Standard selectors failed. Trying text-based "more" finder...');

        try {
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, span, #description'));
                const moreBtn = buttons.find(b => {
                    const text = b.innerText?.trim() || '';
                    return text.includes('...more') || text === 'more' || text === 'Show more';
                });
                if (moreBtn) {
                    moreBtn.click();
                    return true;
                }
                return false;
            });
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
            console.log('[Puppeteer] Text-based click failed:', e.message);
        }
    }

    // Final Verification
    if (await isExpanded()) {
        console.log('[Puppeteer] Description successfully expanded.');
        expanded = true;
    } else {
        console.log('[Puppeteer] Description expansion may have failed (will continue anyway).');
    }

    // Scroll down to make transcript button visible
    await page.evaluate(() => window.scrollBy(0, 300));
    await new Promise(r => setTimeout(r, 800));
}

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
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36');

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

            // 0. Handle Ads (Removed - Plugin handles this)
            // await handleAds(page);

            // Consent
            try {
                const consentSelector = 'button[aria-label="Accept all"], button[aria-label="Reject all"]';
                if (await page.$(consentSelector)) {
                    await page.click(consentSelector);
                    await new Promise(r => setTimeout(r, 2000));
                }
            } catch (e) { }

            // 0. Handle Ads EARLY - before any other interactions
            // Ads can block the entire page and prevent button clicks
            await handleAds(page);

            await page.evaluate(() => window.scrollBy(0, 500));
            await new Promise(r => setTimeout(r, 1000));

            // 1. Metadata
            const titlePromise = page.$eval('h1.ytd-video-primary-info-renderer', el => el.innerText)
                .catch(() => page.title());

            // ---------------------------------------------------------
            // NETWORK INTERCEPTION STRATEGY (Most Robust with Reload)
            // ---------------------------------------------------------

            let transcript = libraryTranscript || '';

            if (!transcript) {
                const MAX_TRANSCRIPT_RETRIES = 3;
                let transcriptResult = null;

                for (let attempt = 1; attempt <= MAX_TRANSCRIPT_RETRIES && !transcriptResult; attempt++) {
                    console.log(`[Puppeteer] Transcript attempt ${attempt}/${MAX_TRANSCRIPT_RETRIES}...`);

                    // RECOVERY STRATEGY: From Attempt 2 onwards, try RELOADING the page
                    // This fixes FAILED_PRECONDITION (400) errors caused by stale session/player state
                    if (attempt > 1) {
                        console.log('⚠️ [Puppeteer] Previous attempt failed. Reloading page to reset API state...');
                        try {
                            // Reload and wait for network idle
                            await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });

                            // Re-run setup sequence
                            await handleAds(page);
                            await page.evaluate(() => window.scrollBy(0, 500));

                            // Re-expand description
                            await expandDescription(page);

                        } catch (reloadError) {
                            console.error('[Puppeteer] Reload failed:', reloadError.message);
                        }
                    } else {
                        // First attempt: Just run expansion
                        await expandDescription(page);
                    }

                    // 3. Click "Show transcript"
                    console.log('[Puppeteer] Searching for "Show transcript"...');

                    // Search for button
                    let transcriptBtn = await page.waitForSelector('xpath/.//button[contains(., "Show transcript")]', { visible: true, timeout: 5000 }).catch(() => null);

                    if (transcriptBtn) {
                        console.log('[Puppeteer] Found button (Manual). Ensuring player is ready...');

                        // Ensure player is ready (often helps with session token readiness)
                        await page.waitForSelector('#movie_player').catch(() => { });

                        // CRITICAL: Handle any ads before proceeding
                        await handleAds(page);

                        console.log('[Puppeteer] Ensuring video player has initialized...');
                        try {
                            // Click play button if paused
                            const playState = await page.evaluate(() => {
                                const player = document.querySelector('#movie_player');
                                if (player && player.classList.contains('paused-mode')) {
                                    const playBtn = document.querySelector('.ytp-play-button');
                                    if (playBtn) playBtn.click();
                                    return 'clicked_play';
                                }
                                return player ? 'playing' : 'no_player';
                            });
                            console.log(`[Puppeteer] Player state: ${playState}`);

                            // Wait for player
                            await new Promise(r => setTimeout(r, 2000));

                            // Pause the video so we can read transcript
                            await page.evaluate(() => {
                                const player = document.querySelector('#movie_player');
                                if (player && !player.classList.contains('paused-mode')) {
                                    const playBtn = document.querySelector('.ytp-play-button');
                                    if (playBtn) playBtn.click();
                                }
                            });
                        } catch (e) {
                            console.log('[Puppeteer] Player init error (non-fatal):', e.message);
                        }

                        // Close any open transcript panel before clicking (if existing)
                        try {
                            const closeBtn = await page.$('button[aria-label="Close transcript"]');
                            if (closeBtn) {
                                await closeBtn.click();
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        } catch (e) { }


                        console.log('[Puppeteer] Hovering and waiting to ensure API context...');
                        await page.hover('xpath/.//button[contains(., "Show transcript")]');
                        await new Promise(r => setTimeout(r, 1000));

                        console.log('[Puppeteer] Clicking...');

                        // Track error state for this attempt
                        let gotError = false;
                        let responseCount = 0;

                        // Create a Promise for the Network Interception
                        const networkPromise = new Promise(resolve => {
                            const responseHandler = async response => {
                                const url = response.url();
                                if (url.includes('/get_transcript') || url.includes('/timedtext')) {
                                    responseCount++;
                                    console.log(`[Puppeteer] Intercepted transcript endpoint #${responseCount}: ${url}`);
                                    try {
                                        const json = await response.json();

                                        // Check for API Error
                                        if (json.error || json.status === 'FAILED_PRECONDITION') {
                                            console.log(`[Puppeteer] API RETURNED ERROR: ${JSON.stringify(json.error || json)}`);
                                            gotError = true;
                                            resolve({ error: true });
                                            return;
                                        }

                                        // Recursive finder
                                        const findSegments = (obj) => {
                                            let results = [];
                                            if (!obj || typeof obj !== 'object') return results;

                                            if (obj.transcriptSegmentRenderer) {
                                                results.push(obj.transcriptSegmentRenderer);
                                            }
                                            if (obj.segs && Array.isArray(obj.segs)) {
                                                obj.segs.forEach(s => {
                                                    if (s.utf8) results.push({ snippet: { runs: [{ text: s.utf8 }] } });
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

                                            if (text.length > 100) {
                                                console.log(`[Puppeteer] Intercepted ${text.length} chars via Network! Resolution triggered.`);
                                                page.off('response', responseHandler);
                                                resolve({ text });
                                            }
                                        }
                                    } catch (e) { console.log('[Puppeteer] Network parsing failed:', e.message); }
                                }
                            };

                            page.on('response', responseHandler);

                            // Timeout
                            setTimeout(() => {
                                page.off('response', responseHandler);
                                console.log(`[Puppeteer] Network timeout (attempt ${attempt}).`);
                                resolve(null);
                            }, 12000);
                        });

                        // Trigger the network request by clicking
                        // Re-find button to avoid stale element handle
                        const freshBtn = await page.$('xpath/.//button[contains(., "Show transcript")]');
                        if (freshBtn) {
                            await freshBtn.click();
                        } else {
                            console.log('[Puppeteer] Transcript button lost before click');
                        }

                        console.log('[Puppeteer] Clicked. Racing Network vs DOM...');

                        // DOM Promise
                        const domPromise = (async () => {
                            try {
                                console.log('[Puppeteer] Waiting for DOM elements...');
                                await page.waitForSelector('.segment-text, ytd-transcript-segment-renderer', { timeout: 10000 });

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
                                if (text.length > 0) return { text };
                            } catch (e) {
                                console.log('[Puppeteer] DOM wait timed out or failed.');
                            }
                            return null;
                        })();

                        // RACE THEM!
                        const result = await Promise.race([networkPromise, domPromise]);

                        if (result && result.text) {
                            transcriptResult = result.text;
                            console.log(`[Puppeteer] Race won! Transcript extracted (${transcriptResult.length} chars).`);
                        } else if (result && result.error) {
                            console.log(`[Puppeteer] Got error on attempt ${attempt}, will ${attempt < MAX_TRANSCRIPT_RETRIES ? 'retry' : 'give up'}...`);
                        } else {
                            console.log(`[Puppeteer] No result on attempt ${attempt}.`);
                        }

                    } else {
                        console.log('[Puppeteer] "Show transcript" button NOT found.');
                        await page.screenshot({ path: 'debug_no_transcript_btn.png' });
                    }
                } // End Retry Loop

                if (transcriptResult) {
                    transcript = transcriptResult;
                } else {
                    console.log('[Puppeteer] All transcript extraction attempts failed.');
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