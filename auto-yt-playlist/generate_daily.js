const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { subHours, format, parseISO } = require('date-fns');
const axios = require('axios');
const xml2js = require('xml2js');

const CHANNELS_FILE = path.join(__dirname, 'channels.json');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Configuration
const HOURS_LOOKBACK = 48;

// Log collector for browser display
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

async function generateDailyPlaylist() {
    // Reset logs for this run
    collectedLogs = [];

    const channels = await loadChannels();
    const allVideos = [];
    const now = new Date();
    const cutOffDate = subHours(now, HOURS_LOOKBACK);

    log(`🎬 Starting playlist generation`);
    log(`📅 Looking for videos published after: ${cutOffDate.toISOString()}`);
    log(`📺 Channels to scan: ${channels.length}`);
    let channelsModified = false;

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

            // Filter Shorts (only if we have duration data)
            const filteredVideos = recentVideos.filter(v => {
                if (channel.include_shorts) return true;

                // If we have duration, use it
                if (v.duration && v.duration < 60) {
                    console.log(`  [SKIP] Short (<60s): ${v.title}`);
                    return false;
                }

                // Title-based filtering
                if (v.title && v.title.toLowerCase().includes('#shorts')) {
                    console.log(`  [SKIP] #Shorts: ${v.title}`);
                    return false;
                }

                return true;
            });

            console.log(`  [SHORTS FILTER] ${filteredVideos.length}/${recentVideos.length} passed`);
            console.log(`  ✅ FINAL: ${filteredVideos.length} videos from ${channel.name}`);

            allVideos.push(...filteredVideos);

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
    log(`📊 SUMMARY: Found ${allVideos.length} total videos`);
    log(`========================================`);

    if (allVideos.length === 0) {
        console.log('❌ No new videos found.');
        return { success: true, videoCount: 0 };
    }

    // Sort by date (descending)
    allVideos.sort((a, b) => b.upload_date.localeCompare(a.upload_date));

    // Generate outputs
    const dateStr = format(now, 'yyyy-MM-dd');
    const timestamp = format(now, 'HH-mm-ss');
    const outputBase = path.join(OUTPUT_DIR, `${dateStr}_${timestamp}`);

    // 1. JSON
    fs.writeFileSync(`${outputBase}.json`, JSON.stringify(allVideos, null, 2));
    console.log(`💾 Saved JSON: ${outputBase}.json`);

    // 2. Markdown
    const videoIds = allVideos.map(v => v.id).join(',');
    const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds}`;

    let mdContent = `# Daily Playlist - ${dateStr}\n\n`;
    mdContent += `Generated at: ${new Date().toLocaleTimeString()}\n\n`;
    mdContent += `### [▶️ Click to Watch All (${allVideos.length} videos)](${playlistUrl})\n\n`;
    mdContent += `## Videos\n\n`;

    allVideos.forEach(v => {
        const title = v.title || 'Untitled';
        const channel = v.channelName || 'Unknown';
        const url = `https://www.youtube.com/watch?v=${v.id}`;
        const duration = v.duration
            ? `${Math.floor(v.duration / 60)}:${(v.duration % 60).toString().padStart(2, '0')}`
            : '??:??';

        mdContent += `- **${channel}**: [${title}](${url}) (${duration})\n`;
    });

    fs.writeFileSync(`${outputBase}.md`, mdContent);
    log(`📄 Saved Markdown: ${outputBase}.md`);

    return { success: true, videoCount: allVideos.length, logs: collectedLogs };
}

if (require.main === module) {
    generateDailyPlaylist();
}

module.exports = { generateDailyPlaylist };
