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

async function loadChannels() {
    if (!fs.existsSync(CHANNELS_FILE)) {
        console.error('channels.json not found!');
        return [];
    }
    const data = fs.readFileSync(CHANNELS_FILE, 'utf-8');
    return JSON.parse(data);
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

        const videos = json.feed.entry.map(entry => ({
            id: entry['yt:videoId'][0],
            title: entry.title[0],
            published: entry.published[0],
            channelName: channelName,
            // Convert published date to YYYYMMDD format for compatibility
            upload_date: entry.published[0].substring(0, 10).replace(/-/g, ''),
            // No duration in RSS, set to null (will need yt-dlp for accurate shorts filtering)
            duration: null
        }));

        console.log(`  [RSS] Fetched ${videos.length} videos`);
        return videos;
    } catch (error) {
        console.error(`  [RSS ERROR] ${error.message}`);
        return [];
    }
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
    const channels = await loadChannels();
    const allVideos = [];
    const now = new Date();
    const cutOffDate = subHours(now, HOURS_LOOKBACK);

    console.log(`\n🎬 Starting playlist generation`);
    console.log(`📅 Looking for videos published after: ${cutOffDate.toISOString()}`);
    console.log(`📺 Channels to scan: ${channels.length}\n`);

    for (const channel of channels) {
        try {
            console.log(`\n========================================`);
            console.log(`📺 Processing: ${channel.name}`);
            console.log(`🔗 URL: ${channel.url}`);
            console.log(`========================================`);

            // Step 1: Resolve channel_id from URL
            console.log(`  [STEP 1] Resolving channel_id...`);
            const channelId = await resolveChannelId(channel.url);

            let videos = [];

            if (channelId) {
                console.log(`  [STEP 1] ✅ Channel ID: ${channelId}`);

                // Step 2: Fetch videos via RSS (fast and reliable)
                console.log(`  [STEP 2] Fetching videos via RSS...`);
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

    console.log(`\n========================================`);
    console.log(`📊 SUMMARY: Found ${allVideos.length} total videos`);
    console.log(`========================================\n`);

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
    console.log(`📄 Saved Markdown: ${outputBase}.md`);

    return { success: true, videoCount: allVideos.length };
}

if (require.main === module) {
    generateDailyPlaylist();
}

module.exports = { generateDailyPlaylist };
