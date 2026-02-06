const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { subHours, format, parseISO } = require('date-fns');
const axios = require('axios');
const xml2js = require('xml2js');

// ============ Paths ============
const CHANNELS_FILE = path.join(__dirname, 'channels.json');
const FILTERS_FILE = path.join(__dirname, 'filters.json');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Database import — use the correct path to the shared database service
const Database = require('../src/services/database');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Configuration
const HOURS_LOOKBACK = 48;

// ============ Concurrency Lock ============
let isGenerating = false;

// ============ Log Collector ============
let collectedLogs = [];
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { timestamp, type, message };
    collectedLogs.push(entry);

    // Also print to terminal
    if (type === 'error') {
        console.error(message);
    } else if (type === 'warn') {
        console.warn(message);
    } else {
        console.log(message);
    }
}

// ============ Channel Management ============
async function loadChannels() {
    if (!fs.existsSync(CHANNELS_FILE)) {
        console.error('channels.json not found!');
        return [];
    }
    const data = fs.readFileSync(CHANNELS_FILE, 'utf-8');
    return JSON.parse(data);
}

/**
 * Save channels back to file (for caching channel IDs)
 */
function saveChannels(channels) {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
}

// ============ Filter Management ============
function loadFilters() {
    if (!fs.existsSync(FILTERS_FILE)) {
        log('⚠️ filters.json not found, using defaults', 'warn');
        return { block_list: [], allow_list: [], category_rules: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8'));
    } catch (e) {
        log(`⚠️ Error parsing filters.json: ${e.message}`, 'warn');
        return { block_list: [], allow_list: [], category_rules: {} };
    }
}

/**
 * Weighted keyword filter — uses a score-based system instead of binary allow/block.
 * 
 * Score = (allow_hits × allow_weight) - (block_hits × block_weight)
 * If score > threshold → KEEP, else DROP
 * 
 * Category weights make finance channels more lenient with block words,
 * and entertainment channels stricter.
 */
function applyWeightedFilter(videos, filters) {
    const { block_list = [], allow_list = [], category_rules = {} } = filters;

    const results = {
        kept: [],
        dropped: [],
        stats: { total: videos.length, kept: 0, dropped: 0, reasons: {} }
    };

    for (const video of videos) {
        const text = `${video.title || ''} ${video.description || ''}`.toLowerCase();
        const category = video.category || 'other';
        const rules = category_rules[category] || { allow_weight: 1.0, block_weight: 1.5, threshold: 0 };

        // Count hits
        let allowHits = 0;
        let blockHits = 0;
        const matchedAllow = [];
        const matchedBlock = [];

        for (const term of allow_list) {
            if (text.includes(term.toLowerCase())) {
                allowHits++;
                matchedAllow.push(term);
            }
        }

        for (const term of block_list) {
            if (text.includes(term.toLowerCase())) {
                blockHits++;
                matchedBlock.push(term);
            }
        }

        // Calculate score
        const score = (allowHits * (rules.allow_weight || 1.0)) - (blockHits * (rules.block_weight || 1.5));
        const threshold = rules.threshold || 0;

        // Decision
        if (blockHits === 0 && allowHits === 0) {
            // Neutral — no filter terms matched, keep by default
            video.filter_score = 0;
            video.filter_reason = 'neutral';
            results.kept.push(video);
            results.stats.kept++;
        } else if (score >= threshold) {
            // Score is positive or neutral — keep
            video.filter_score = score;
            video.filter_reason = `kept: allow[${matchedAllow.join(',')}] > block[${matchedBlock.join(',')}] (score: ${score.toFixed(1)})`;
            results.kept.push(video);
            results.stats.kept++;
            if (matchedBlock.length > 0) {
                log(`  [FILTER] ✅ KEPT despite block words: "${video.title}" (score: ${score.toFixed(1)}, allow: [${matchedAllow}], block: [${matchedBlock}])`, 'info');
            }
        } else {
            // Score is negative — drop
            video.filter_score = score;
            video.filter_reason = `blocked: block[${matchedBlock.join(',')}] > allow[${matchedAllow.join(',')}] (score: ${score.toFixed(1)})`;
            results.dropped.push(video);
            results.stats.dropped++;
            const reason = matchedBlock.join(', ');
            results.stats.reasons[reason] = (results.stats.reasons[reason] || 0) + 1;
            log(`  [FILTER] ❌ DROPPED: "${video.title}" (score: ${score.toFixed(1)}, blocked by: [${matchedBlock}])`, 'warn');
        }
    }

    return results;
}

// ============ Channel ID Resolution ============
/**
 * Resolve channel_id from a YouTube channel URL using yt-dlp
 */
async function resolveChannelId(channelUrl) {
    return new Promise((resolve) => {
        const args = [
            '--print', 'channel_id',
            '--playlist-end', '1',
            channelUrl
        ];

        const process = spawn('yt-dlp', args);
        let outputData = '';
        let errorData = '';

        process.stdout.on('data', (data) => {
            outputData += data.toString();
        });

        process.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        process.on('close', (code) => {
            if (code !== 0 || !outputData.trim()) {
                console.warn(`  [WARN] Could not resolve channel_id for ${channelUrl}`);
                resolve(null);
                return;
            }
            resolve(outputData.trim().split('\n')[0]);
        });
    });
}

// ============ Video Fetching ============
/**
 * Fetch videos via YouTube RSS feed (fast and reliable)
 */
async function fetchVideosViaRSS(channelId, channelName) {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    console.log(`  [RSS] Fetching from: ${rssUrl}`);

    try {
        const response = await axios.get(rssUrl, { timeout: 10000 });
        const json = await xml2js.parseStringPromise(response.data);

        if (!json.feed || !json.feed.entry) {
            console.log(`  [RSS] No entries in feed`);
            return [];
        }

        const videos = json.feed.entry.map(entry => {
            const videoId = entry['yt:videoId'][0];
            const title = entry.title[0];
            return {
                id: videoId,
                title: title,
                published: entry.published[0],
                channelName: channelName,
                // Convert published date to YYYYMMDD format for compatibility
                upload_date: entry.published[0].substring(0, 10).replace(/-/g, ''),
                // No duration in RSS, set to null (will need yt-dlp for accurate shorts filtering)
                duration: null,
                // YouTube thumbnail URL
                thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
                // Categorize by title keywords
                category: categorizeVideo(title)
            };
        });

        console.log(`  [RSS] Fetched ${videos.length} videos`);
        return videos;
    } catch (error) {
        console.error(`  [RSS ERROR] ${error.message}`);
        return [];
    }
}

/**
 * Categorize video based on title keywords
 */
function categorizeVideo(title) {
    const titleLower = title.toLowerCase();

    // Finance keywords
    const financeKeywords = ['stock', 'market', 'invest', 'trading', 'crypto', 'bitcoin', 'economy', 'fed', 'inflation', 'earnings', 'dividend', 'finance', 'money', 'banking', 'treasury', 'bonds', 'etf', 'nasdaq', 's&p', 'dow', 'forex', 'portfolio', 'valuation', 'hedge', 'yield'];
    if (financeKeywords.some(kw => titleLower.includes(kw))) return 'finance';

    // Sports keywords
    const sportsKeywords = ['game', 'score', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis', 'golf', 'olympics', 'playoff', 'championship', 'super bowl', 'world cup', 'athlete', 'espn'];
    if (sportsKeywords.some(kw => titleLower.includes(kw))) return 'sports';

    // Cooking keywords
    const cookingKeywords = ['recipe', 'cook', 'bake', 'food', 'kitchen', 'meal', 'dinner', 'lunch', 'breakfast', 'chef', 'ingredient', 'cuisine', 'grill', 'roast', 'fry'];
    if (cookingKeywords.some(kw => titleLower.includes(kw))) return 'cooking';

    // Tech keywords
    const techKeywords = ['tech', 'software', 'ai', 'artificial intelligence', 'machine learning', 'coding', 'programming', 'gadget', 'smartphone', 'computer', 'apple', 'google', 'microsoft', 'startup', 'app', 'developer'];
    if (techKeywords.some(kw => titleLower.includes(kw))) return 'tech';

    // News keywords
    const newsKeywords = ['breaking', 'news', 'politics', 'election', 'president', 'congress', 'senate', 'government', 'policy', 'law', 'court', 'supreme', 'ukraine', 'china', 'war', 'crisis'];
    if (newsKeywords.some(kw => titleLower.includes(kw))) return 'news';

    return 'other';
}

/**
 * Fallback: Fetch videos using yt-dlp (slower but more complete metadata)
 */
function fetchVideosViaYtDlp(channel) {
    return new Promise((resolve) => {
        console.log(`  [YT-DLP] Fallback fetching for: ${channel.name}`);

        let channelUrl = channel.url;
        if (!channelUrl.endsWith('/videos') && !channelUrl.endsWith('/shorts') && !channelUrl.endsWith('/streams')) {
            channelUrl = channelUrl.replace(/\/$/, '') + '/videos';
        }

        const args = [
            '--dump-single-json',
            '--playlist-end', '10',
            '--skip-download',
            channelUrl
        ];

        const process = spawn('yt-dlp', args);
        let outputData = '';
        let errorData = '';

        process.stdout.on('data', (data) => {
            outputData += data.toString();
        });

        process.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        process.on('close', (code) => {
            if (code !== 0) {
                console.warn(`  [YT-DLP ERROR] Exit code ${code}`);
                resolve([]);
                return;
            }

            try {
                const json = JSON.parse(outputData);
                if (json.entries) {
                    console.log(`  [YT-DLP] Fetched ${json.entries.length} videos`);
                    resolve(json.entries.map(entry => ({ ...entry, channelName: channel.name })));
                } else {
                    resolve([]);
                }
            } catch (e) {
                console.error(`  [YT-DLP] JSON parse failed`);
                resolve([]);
            }
        });
    });
}

/**
 * Batch fetch durations for videos that don't have them (e.g. from RSS).
 * Uses yt-dlp --print duration for each video ID.
 */
async function fetchBatchDurations(videos) {
    const needDuration = videos.filter(v => v.duration == null);
    if (needDuration.length === 0) return videos;

    log(`  [DURATION] Fetching durations for ${needDuration.length} videos via yt-dlp...`);

    // Build a batch of video URLs
    const ids = needDuration.map(v => v.id);
    const urls = ids.map(id => `https://www.youtube.com/watch?v=${id}`);

    return new Promise((resolve) => {
        const args = [
            '--print', '%(id)s %(duration)s',
            '--no-download',
            '--no-warnings',
            '--ignore-errors',
            ...urls
        ];

        const proc = spawn('yt-dlp', args);
        let outputData = '';

        const timeout = setTimeout(() => {
            log(`  [DURATION] Timeout after 60s, using what we have`, 'warn');
            proc.kill();
        }, 60000);

        proc.stdout.on('data', (data) => { outputData += data.toString(); });
        proc.stderr.on('data', () => { }); // ignore stderr

        proc.on('close', () => {
            clearTimeout(timeout);

            // Parse output: "videoId duration" per line
            const durationMap = {};
            for (const line of outputData.trim().split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const id = parts[0];
                    const dur = parseInt(parts[1]);
                    if (!isNaN(dur)) durationMap[id] = dur;
                }
            }

            let enriched = 0;
            for (const v of videos) {
                if (v.duration == null && durationMap[v.id] != null) {
                    v.duration = durationMap[v.id];
                    enriched++;
                }
            }
            log(`  [DURATION] Enriched ${enriched}/${needDuration.length} videos with duration data`);
            resolve(videos);
        });
    });
}

/**
 * Classify video into context tiers based on duration.
 * Tier A (Deep Dive): > 5 minutes
 * Tier B (Update): 1 - 5 minutes  
 * Tier C (Short): < 1 minute
 */
function classifyContextTier(duration) {
    if (duration == null) return 'B'; // Default to B if unknown
    if (duration >= 300) return 'A'; // > 5 min
    if (duration >= 60) return 'B';  // 1-5 min
    return 'C';                      // < 1 min
}

// ============ Daily File Helpers ============

/**
 * Get today's daily file path (YYYY-MM-DD.json)
 */
function getDailyFilePath(dateStr) {
    return path.join(OUTPUT_DIR, `${dateStr}.json`);
}

/**
 * Load existing daily file, or return empty array
 */
function loadDailyFile(dateStr) {
    const filePath = getDailyFilePath(dateStr);
    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return Array.isArray(data) ? data : [];
        } catch (e) {
            log(`⚠️ Error parsing daily file ${dateStr}.json: ${e.message}`, 'warn');
            return [];
        }
    }
    return [];
}

/**
 * Save the daily file (JSON + Markdown)
 */
function saveDailyFile(dateStr, videos) {
    const jsonPath = getDailyFilePath(dateStr);
    const mdPath = jsonPath.replace('.json', '.md');

    // Save JSON
    fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));
    log(`💾 Saved JSON: ${jsonPath}`);

    // Generate Markdown report
    const pendingVideos = videos.filter(v => v.status === 'pending');
    const approvedVideos = videos.filter(v => v.status === 'approved');
    const extractedVideos = videos.filter(v => v.status === 'extracted');
    const ignoredVideos = videos.filter(v => v.status === 'ignored');

    // Build playlist URL from pending + approved (not-yet-processed) videos
    const activeVideos = [...pendingVideos, ...approvedVideos];
    const videoIds = activeVideos.map(v => v.id).join(',');
    const playlistUrl = videoIds ? `https://www.youtube.com/watch_videos?video_ids=${videoIds}` : '';

    let mdContent = `# Daily Playlist - ${dateStr}\n\n`;
    mdContent += `Generated at: ${new Date().toLocaleTimeString()}\n\n`;
    mdContent += `📊 **Status**: ${pendingVideos.length} pending | ${approvedVideos.length} approved | ${extractedVideos.length} extracted | ${ignoredVideos.length} ignored\n\n`;

    if (playlistUrl) {
        mdContent += `### [▶️ Watch Active Videos (${activeVideos.length})](${playlistUrl})\n\n`;
    }

    mdContent += `## Videos\n\n`;

    videos.forEach(v => {
        const title = v.title || 'Untitled';
        const channel = v.channelName || 'Unknown';
        const url = `https://www.youtube.com/watch?v=${v.id}`;
        const statusIcon = { pending: '⏳', approved: '✅', extracted: '📝', ignored: '🚫' }[v.status] || '❓';
        const duration = v.duration
            ? `${Math.floor(v.duration / 60)}:${(v.duration % 60).toString().padStart(2, '0')}`
            : '??:??';

        mdContent += `- ${statusIcon} **${channel}**: [${title}](${url}) (${duration}) [${v.category || 'other'}]\n`;
    });

    fs.writeFileSync(mdPath, mdContent);
    log(`📄 Saved Markdown: ${mdPath}`);
}

// ============ Main Generation Function ============

async function generateDailyPlaylist() {
    // Concurrency guard
    if (isGenerating) {
        return {
            success: false,
            error: 'Generation already in progress. Please wait for the current run to finish.',
            logs: []
        };
    }

    isGenerating = true;
    collectedLogs = []; // Reset logs for this run

    try {
        const channels = await loadChannels();
        const filters = loadFilters();
        const allNewVideos = [];
        const now = new Date();
        const dateStr = format(now, 'yyyy-MM-dd');
        const cutOffDate = subHours(now, HOURS_LOOKBACK);

        log(`🎬 Starting Daily Feed Sync`);
        log(`📅 Date: ${dateStr}`);
        log(`📅 Looking for videos published after: ${cutOffDate.toISOString()}`);
        log(`📺 Channels to scan: ${channels.length}`);
        log(`🔍 Filter: ${filters.block_list.length} block terms, ${filters.allow_list.length} allow terms`);

        // Load existing daily file for merge
        const existingVideos = loadDailyFile(dateStr);
        const existingIds = new Set(existingVideos.map(v => v.id));
        log(`📂 Existing daily file: ${existingVideos.length} videos already tracked`);

        let channelsModified = false;

        // ============ Fetch Phase ============
        for (const channel of channels) {
            try {
                log(`========================================`);
                log(`📺 Processing: ${channel.name}`);
                log(`🔗 URL: ${channel.url}`);
                log(`========================================`);

                // Step 1: Get channel_id (from cache or resolve via yt-dlp)
                let channelId = channel.channel_id; // Check cache first

                if (channelId) {
                    log(`  [STEP 1] ⚡ Using cached channel ID: ${channelId}`);
                } else {
                    log(`  [STEP 1] Resolving channel_id via yt-dlp...`);
                    channelId = await resolveChannelId(channel.url);

                    if (channelId) {
                        log(`  [STEP 1] ✅ Resolved: ${channelId} (will cache)`);
                        // Cache the ID for future runs
                        channel.channel_id = channelId;
                        channelsModified = true;
                    }
                }

                let videos = [];

                if (channelId) {
                    // Step 2: Fetch videos via RSS (fast and reliable)
                    log(`  [STEP 2] Fetching videos via RSS...`);
                    videos = await fetchVideosViaRSS(channelId, channel.name);
                }

                // Fallback to yt-dlp if RSS failed
                if (videos.length === 0) {
                    console.log(`  [FALLBACK] Trying yt-dlp...`);
                    videos = await fetchVideosViaYtDlp(channel);
                }

                console.log(`  [RAW] Total videos found: ${videos.length}`);

                if (videos.length === 0) {
                    console.log(`  ⚠️ No videos found for this channel`);
                    continue;
                }

                // Log sample
                console.log(`  [SAMPLE] First 3 videos:`);
                videos.slice(0, 3).forEach((v, i) => {
                    console.log(`    ${i + 1}. ${v.title} (${v.upload_date})`);
                });

                // Filter by date
                const recentVideos = videos.filter(video => {
                    if (!video.upload_date) {
                        console.log(`  [SKIP] No date: ${video.title}`);
                        return false;
                    }

                    const y = parseInt(video.upload_date.substring(0, 4));
                    const m = parseInt(video.upload_date.substring(4, 6)) - 1;
                    const d = parseInt(video.upload_date.substring(6, 8));
                    const uploadDate = new Date(y, m, d);

                    const cutoff = new Date(cutOffDate);
                    cutoff.setHours(0, 0, 0, 0);

                    const isRecent = uploadDate >= cutoff;

                    if (!isRecent) {
                        console.log(`  [SKIP] Too old: ${video.title} (${video.upload_date})`);
                    }
                    return isRecent;
                });

                console.log(`  [DATE FILTER] ${recentVideos.length}/${videos.length} passed`);

                // Try to enrich durations for RSS videos (they come without duration)
                const durEnrichedVideos = await fetchBatchDurations(recentVideos);

                // V3 Context Tiering: classify + filter shorts
                const shortsStrategy = channel.shorts_strategy || 'separate';
                const filteredVideos = durEnrichedVideos.filter(v => {
                    // Classify tier
                    v.context_tier = classifyContextTier(v.duration);
                    v.is_short = v.context_tier === 'C';

                    // Title-based short detection (fallback if no duration)
                    if (v.title && v.title.toLowerCase().includes('#shorts')) {
                        v.is_short = true;
                        v.context_tier = 'C';
                    }

                    // If channel explicitly includes shorts, keep all
                    if (channel.include_shorts) return true;

                    // V3: Strict filtering for shorts — must hit an allow_list keyword
                    if (v.is_short) {
                        const titleLower = (v.title || '').toLowerCase();
                        const { allow_list = [] } = loadFilters();
                        const hasAllowHit = allow_list.some(term => titleLower.includes(term.toLowerCase()));

                        if (hasAllowHit) {
                            log(`  [SHORTS] ✅ Kept short (keyword match): "${v.title}"`);
                            return true;
                        } else if (shortsStrategy === 'exclude') {
                            log(`  [SHORTS] ❌ Excluded short (no keyword): "${v.title}"`);
                            return false;
                        } else {
                            // 'separate' strategy: keep but mark for UI segregation
                            log(`  [SHORTS] 📱 Kept short (separate): "${v.title}"`);
                            return true;
                        }
                    }

                    return true;
                });

                console.log(`  [SHORTS FILTER] ${filteredVideos.length}/${recentVideos.length} passed`);

                // Dedup against today's existing file
                const newOnlyVideos = filteredVideos.filter(v => {
                    if (existingIds.has(v.id)) {
                        console.log(`  [SKIP] Already in today's list: ${v.title}`);
                        return false;
                    }
                    return true;
                });

                console.log(`  [DAILY DEDUP] ${newOnlyVideos.length}/${filteredVideos.length} are new`);
                console.log(`  ✅ FINAL: ${newOnlyVideos.length} new videos from ${channel.name}`);

                allNewVideos.push(...newOnlyVideos);

            } catch (err) {
                console.error(`  ❌ ERROR: ${err.message}`);
            }
        }

        // Save cached channel IDs to file if any were resolved
        if (channelsModified) {
            saveChannels(channels);
            log(`💾 Cached ${channels.filter(c => c.channel_id).length} channel IDs to channels.json`);
        }

        log(`========================================`);
        log(`📊 FETCH SUMMARY: Found ${allNewVideos.length} new videos`);
        log(`========================================`);

        // ============ Database Dedup Phase ============
        let dbDeduped = 0;
        let videosAfterDbDedup = allNewVideos;

        if (allNewVideos.length > 0) {
            try {
                const newVideoIds = allNewVideos.map(v => v.id);
                const existingInDb = await Database.checkMultipleVideosExist(newVideoIds);
                dbDeduped = existingInDb.size;

                if (dbDeduped > 0) {
                    videosAfterDbDedup = allNewVideos.filter(v => {
                        if (existingInDb.has(v.id)) {
                            log(`  [DB DEDUP] Already extracted: "${v.title}" (${v.id})`, 'info');
                            return false;
                        }
                        return true;
                    });
                    log(`🗄️ Database dedup: ${dbDeduped} videos already in database, ${videosAfterDbDedup.length} remaining`);
                } else {
                    log(`🗄️ Database dedup: 0 duplicates found`);
                }
            } catch (dbErr) {
                log(`⚠️ Database dedup failed: ${dbErr.message}. Skipping DB check.`, 'warn');
                videosAfterDbDedup = allNewVideos;
            }
        }

        // ============ Filter Phase ============
        let filterStats = { kept: 0, dropped: 0, reasons: {} };
        let keptVideos = videosAfterDbDedup;

        if (videosAfterDbDedup.length > 0 && (filters.block_list.length > 0 || filters.allow_list.length > 0)) {
            const filterResult = applyWeightedFilter(videosAfterDbDedup, filters);
            keptVideos = filterResult.kept;
            filterStats = filterResult.stats;
            log(`🔍 Filter results: ${filterStats.kept} kept, ${filterStats.dropped} dropped`);
            if (Object.keys(filterStats.reasons).length > 0) {
                log(`   Block reasons: ${JSON.stringify(filterStats.reasons)}`);
            }
        }

        // ============ Enrich with V2 + V3 fields ============
        const enrichedNewVideos = keptVideos.map(v => ({
            id: v.id,
            title: v.title,
            published: v.published,
            channelName: v.channelName,
            upload_date: v.upload_date,
            duration: v.duration,
            thumbnail: v.thumbnail,
            category: v.category || categorizeVideo(v.title || ''),
            // V2 fields
            status: 'pending',
            auto_extract: false,
            filter_score: v.filter_score || 0,
            filter_reason: v.filter_reason || 'neutral',
            added_at: now.toISOString(),
            // V3 fields
            is_short: v.is_short || false,
            context_tier: v.context_tier || classifyContextTier(v.duration),
            source: v.source || 'subscription',
            tag: v.tag || null,
        }));

        // ============ Merge Phase ============
        const merged = [...existingVideos, ...enrichedNewVideos];

        // Sort: pending first, then approved, then extracted, then ignored
        // Within each group, sort by upload_date descending
        const statusOrder = { pending: 0, approved: 1, extracted: 2, ignored: 3 };
        merged.sort((a, b) => {
            const statusDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
            if (statusDiff !== 0) return statusDiff;
            return (b.upload_date || '').localeCompare(a.upload_date || '');
        });

        // Save merged daily file
        saveDailyFile(dateStr, merged);

        log(`========================================`);
        log(`✅ SYNC COMPLETE`);
        log(`   📊 Total in daily file: ${merged.length}`);
        log(`   🆕 New videos added: ${enrichedNewVideos.length}`);
        log(`   🗄️ DB deduped: ${dbDeduped}`);
        log(`   🔍 Filter dropped: ${filterStats.dropped}`);
        log(`   📂 Previously tracked: ${existingVideos.length}`);
        log(`========================================`);

        return {
            success: true,
            videoCount: merged.length,
            newCount: enrichedNewVideos.length,
            dbDeduped: dbDeduped,
            filterDropped: filterStats.dropped,
            existingCount: existingVideos.length,
            filename: `${dateStr}.json`,
            logs: collectedLogs
        };

    } finally {
        isGenerating = false;
    }
}

if (require.main === module) {
    generateDailyPlaylist().then(result => {
        console.log('\n=== RESULT ===');
        console.log(JSON.stringify(result, null, 2));
    }).catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { generateDailyPlaylist };
