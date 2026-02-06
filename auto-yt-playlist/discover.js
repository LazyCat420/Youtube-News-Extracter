/**
 * Discovery Engine — V3
 * 
 * Breaks the "echo chamber" by finding related videos from new sources.
 * Uses approved video titles as seeds → extracts keywords → searches YouTube via yt-dlp.
 * 
 * Usage:
 *   node discover.js                  # Uses today's date
 *   node discover.js 2026-02-06       # Specific date
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { format } = require('date-fns');

// ============ Paths ============
const FILTERS_FILE = path.join(__dirname, 'filters.json');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Database import for dedup
const Database = require('../src/services/database');

// ============ Configuration ============
const CONFIG = {
    maxSearchQueries: 5,        // Max number of yt-dlp searches to run
    resultsPerSearch: 5,         // Videos per search query (ytsearchN)
    maxApprovedToSample: 5,      // Max approved videos to extract keywords from
    minKeywordLength: 3,         // Skip short keywords
    maxKeywordsPerTitle: 4,      // Top N keywords per title
    searchTimeout: 30000,        // 30s timeout per yt-dlp search
};

// ============ Stop Words ============
const STOP_WORDS = new Set([
    // Common English
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about',
    'against', 'up', 'down', 'this', 'that', 'these', 'those', 'what',
    'which', 'who', 'whom', 'its', 'his', 'her', 'their', 'our', 'my',
    'your', 'it', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'him',
    'us', 'them',
    // YouTube noise
    'video', 'watch', 'live', 'stream', 'new', 'latest', 'today', 'now',
    'full', 'official', 'episode', 'part', 'clip', 'interview', 'show',
    'breaking', 'update', 'recap', 'highlights', 'analysis', 'explained',
    'reaction', 'review', 'morning', 'evening', 'night', 'daily', 'weekly',
]);

// ============ Log Collector ============
let collectedLogs = [];
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { timestamp, type, message };
    collectedLogs.push(entry);
    if (type === 'error') console.error(message);
    else if (type === 'warn') console.warn(message);
    else console.log(message);
}

// ============ Filter Management (shared with generate_daily.js) ============
function loadFilters() {
    if (!fs.existsSync(FILTERS_FILE)) {
        return { block_list: [], allow_list: [], category_rules: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8'));
    } catch (e) {
        log(`⚠️ Error parsing filters.json: ${e.message}`, 'warn');
        return { block_list: [], allow_list: [], category_rules: {} };
    }
}

// Reuse the same weighted filter logic from generate_daily.js
function applyWeightedFilter(videos, filters) {
    const { block_list = [], allow_list = [], category_rules = {} } = filters;
    const results = { kept: [], dropped: [], stats: { total: videos.length, kept: 0, dropped: 0, reasons: {} } };

    for (const video of videos) {
        const text = `${video.title || ''} ${video.description || ''}`.toLowerCase();
        const category = video.category || 'other';
        const rules = category_rules[category] || { allow_weight: 1.0, block_weight: 1.5, threshold: 0 };

        let allowHits = 0, blockHits = 0;
        const matchedAllow = [], matchedBlock = [];

        for (const term of allow_list) {
            if (text.includes(term.toLowerCase())) { allowHits++; matchedAllow.push(term); }
        }
        for (const term of block_list) {
            if (text.includes(term.toLowerCase())) { blockHits++; matchedBlock.push(term); }
        }

        const score = (allowHits * (rules.allow_weight || 1.0)) - (blockHits * (rules.block_weight || 1.5));
        const threshold = rules.threshold || 0;

        if (blockHits === 0 && allowHits === 0) {
            // Discovery videos with NO filter matches get a slight penalty —
            // we only want highly relevant discoveries
            video.filter_score = -0.5;
            video.filter_reason = 'discovery-neutral (no keyword match)';
            results.dropped.push(video);
            results.stats.dropped++;
        } else if (score >= threshold) {
            video.filter_score = score;
            video.filter_reason = `kept: allow[${matchedAllow.join(',')}] > block[${matchedBlock.join(',')}] (score: ${score.toFixed(1)})`;
            results.kept.push(video);
            results.stats.kept++;
        } else {
            video.filter_score = score;
            video.filter_reason = `blocked: block[${matchedBlock.join(',')}] > allow[${matchedAllow.join(',')}] (score: ${score.toFixed(1)})`;
            results.dropped.push(video);
            results.stats.dropped++;
        }
    }
    return results;
}

// ============ Categorize Video (same logic as generate_daily.js) ============
function categorizeVideo(title) {
    const t = title.toLowerCase();
    const financeKw = ['stock', 'market', 'invest', 'trading', 'crypto', 'bitcoin', 'economy', 'fed', 'inflation', 'earnings', 'dividend', 'finance', 'money', 'banking', 'treasury', 'bonds', 'etf', 'nasdaq', 's&p', 'dow', 'forex', 'portfolio', 'valuation', 'hedge', 'yield'];
    if (financeKw.some(k => t.includes(k))) return 'finance';
    const techKw = ['tech', 'software', 'ai', 'artificial intelligence', 'machine learning', 'coding', 'programming', 'gadget', 'smartphone', 'computer', 'apple', 'google', 'microsoft', 'startup', 'app', 'developer'];
    if (techKw.some(k => t.includes(k))) return 'tech';
    const newsKw = ['breaking', 'news', 'politics', 'election', 'president', 'congress', 'senate', 'government', 'policy', 'law', 'court', 'supreme', 'ukraine', 'china', 'war', 'crisis'];
    if (newsKw.some(k => t.includes(k))) return 'news';
    const sportsKw = ['game', 'score', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball'];
    if (sportsKw.some(k => t.includes(k))) return 'sports';
    const cookingKw = ['recipe', 'cook', 'bake', 'food', 'kitchen', 'meal', 'dinner', 'lunch', 'breakfast', 'chef'];
    if (cookingKw.some(k => t.includes(k))) return 'cooking';
    return 'other';
}

// ============ Keyword Extraction ============

/**
 * Extract high-value keywords from a video title.
 * Removes stop words, short words, and scores by apparent importance.
 */
function extractKeywords(title) {
    // Clean: remove special chars, split
    const cleaned = title
        .replace(/[|—–\-:,.'!?#()\[\]{}"/\\@&]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const words = cleaned.split(' ');

    // Filter out stop words, short words, and numbers-only
    const keywords = words.filter(w =>
        w.length >= CONFIG.minKeywordLength &&
        !STOP_WORDS.has(w) &&
        !/^\d+$/.test(w)
    );

    // Score keywords: longer = more specific = higher score
    // Also boost capitalized words from original title (proper nouns)
    const originalWords = title.split(/\s+/);
    const scored = keywords.map(kw => {
        let score = kw.length; // Base score = length
        // Check if original was capitalized (proper noun indicator)
        const orig = originalWords.find(w => w.toLowerCase().startsWith(kw));
        if (orig && orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase()) {
            score += 3; // Proper noun bonus
        }
        return { word: kw, score };
    });

    // Deduplicate and sort by score
    const seen = new Set();
    return scored
        .filter(s => {
            if (seen.has(s.word)) return false;
            seen.add(s.word);
            return true;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, CONFIG.maxKeywordsPerTitle)
        .map(s => s.word);
}

/**
 * Build search queries from a set of approved videos.
 * Combines keywords from multiple videos into targeted queries.
 */
function buildSearchQueries(approvedVideos) {
    // Take top N approved videos
    const sampled = approvedVideos.slice(0, CONFIG.maxApprovedToSample);

    log(`📝 Sampling ${sampled.length} approved videos for keyword extraction`);

    // Extract keywords from each
    const allKeywords = [];
    for (const v of sampled) {
        const kws = extractKeywords(v.title || '');
        log(`  [KEYWORDS] "${v.title}" → [${kws.join(', ')}]`);
        allKeywords.push(...kws);
    }

    // Count keyword frequency across all videos
    const freq = {};
    for (const kw of allKeywords) {
        freq[kw] = (freq[kw] || 0) + 1;
    }

    // Sort by frequency (cross-video relevance), then by length (specificity)
    const ranked = Object.entries(freq)
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .map(e => e[0]);

    // Build queries: combine top keywords into 2-3 word phrases for better results
    const queries = [];

    // Single high-frequency keywords
    for (const kw of ranked.slice(0, 3)) {
        queries.push(kw);
    }

    // Combined pairs of top keywords (more targeted)
    if (ranked.length >= 2) {
        queries.push(`${ranked[0]} ${ranked[1]}`);
    }
    if (ranked.length >= 4) {
        queries.push(`${ranked[2]} ${ranked[3]}`);
    }

    // Deduplicate and limit
    const unique = [...new Set(queries)].slice(0, CONFIG.maxSearchQueries);
    log(`🔎 Generated ${unique.length} search queries: ${JSON.stringify(unique)}`);
    return unique;
}

// ============ YouTube Search via yt-dlp ============

/**
 * Search YouTube using yt-dlp and return video metadata.
 */
function ytSearch(query, maxResults = CONFIG.resultsPerSearch) {
    return new Promise((resolve) => {
        const searchTerm = `ytsearch${maxResults}:${query}`;
        log(`  [SEARCH] Running: yt-dlp "${searchTerm}"`);

        const args = [
            '--dump-single-json',
            '--skip-download',
            '--no-warnings',
            '--flat-playlist',
            searchTerm
        ];

        const proc = spawn('yt-dlp', args);
        let outputData = '';
        let errorData = '';

        const timeout = setTimeout(() => {
            log(`  [SEARCH] Timeout after ${CONFIG.searchTimeout}ms for query: "${query}"`, 'warn');
            proc.kill();
            resolve([]);
        }, CONFIG.searchTimeout);

        proc.stdout.on('data', (data) => { outputData += data.toString(); });
        proc.stderr.on('data', (data) => { errorData += data.toString(); });

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0 || !outputData.trim()) {
                log(`  [SEARCH] Failed for "${query}" (exit: ${code})`, 'warn');
                resolve([]);
                return;
            }

            try {
                const json = JSON.parse(outputData);
                const entries = json.entries || [];
                const videos = entries
                    .filter(e => e && e.id && e.title)
                    .map(e => ({
                        id: e.id,
                        title: e.title,
                        channelName: e.channel || e.uploader || 'Unknown',
                        upload_date: e.upload_date || null,
                        duration: e.duration || null,
                        thumbnail: e.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
                        description: e.description || '',
                        category: categorizeVideo(e.title || ''),
                        // V3 discovery fields
                        source: 'discovery',
                        tag: 'Discovery',
                        discovery_query: query,
                    }));

                log(`  [SEARCH] Found ${videos.length} results for "${query}"`);
                resolve(videos);
            } catch (e) {
                log(`  [SEARCH] JSON parse error for "${query}": ${e.message}`, 'warn');
                resolve([]);
            }
        });
    });
}

// ============ Daily File Helpers ============

function getDailyFilePath(dateStr) {
    return path.join(OUTPUT_DIR, `${dateStr}.json`);
}

function loadDailyFile(dateStr) {
    const filePath = getDailyFilePath(dateStr);
    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return Array.isArray(data) ? data : [];
        } catch (e) {
            log(`⚠️ Error parsing ${dateStr}.json: ${e.message}`, 'warn');
            return [];
        }
    }
    return [];
}

function saveDailyFile(dateStr, videos) {
    const jsonPath = getDailyFilePath(dateStr);
    fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));
    log(`💾 Saved daily file: ${jsonPath} (${videos.length} videos)`);
}

// ============ Main Discovery Function ============

async function runDiscovery(dateStr) {
    collectedLogs = [];
    const now = new Date();
    if (!dateStr) dateStr = format(now, 'yyyy-MM-dd');

    log(`✨ Discovery Engine — Starting`);
    log(`📅 Date: ${dateStr}`);

    // Load today's daily file
    const dailyVideos = loadDailyFile(dateStr);
    if (dailyVideos.length === 0) {
        log(`⚠️ No daily file found for ${dateStr}. Run "Sync Daily Feed" first.`, 'warn');
        return {
            success: false,
            error: 'No daily file found. Sync first.',
            logs: collectedLogs
        };
    }

    // Find approved videos to use as seeds
    const approved = dailyVideos.filter(v => v.status === 'approved');
    // Fallback: if nothing approved yet, use pending videos
    const seeds = approved.length > 0 ? approved : dailyVideos.filter(v => v.status === 'pending');

    if (seeds.length === 0) {
        log(`⚠️ No approved or pending videos to base discovery on.`, 'warn');
        return {
            success: false,
            error: 'No videos to base discovery on. Approve some videos first.',
            logs: collectedLogs
        };
    }

    log(`🌱 Using ${seeds.length} ${approved.length > 0 ? 'approved' : 'pending'} video(s) as seeds`);

    // Build search queries from seed video titles
    const queries = buildSearchQueries(seeds);

    if (queries.length === 0) {
        log(`⚠️ Could not extract any useful keywords.`, 'warn');
        return { success: false, error: 'No keywords extracted.', logs: collectedLogs };
    }

    // Run searches
    log(`========================================`);
    log(`🔍 Running ${queries.length} YouTube searches...`);
    log(`========================================`);

    let allCandidates = [];
    for (const query of queries) {
        const results = await ytSearch(query);
        allCandidates.push(...results);
    }

    log(`📦 Raw discovery candidates: ${allCandidates.length}`);

    if (allCandidates.length === 0) {
        log(`ℹ️ No discovery candidates found.`);
        return {
            success: true,
            searchesRun: queries.length,
            candidatesFound: 0,
            keptAfterFilter: 0,
            addedToDaily: 0,
            logs: collectedLogs
        };
    }

    // ============ Dedup Phase ============
    // 1. Dedup against each other (same video from multiple searches)
    const seenIds = new Set();
    allCandidates = allCandidates.filter(v => {
        if (seenIds.has(v.id)) return false;
        seenIds.add(v.id);
        return true;
    });
    log(`🔄 After self-dedup: ${allCandidates.length}`);

    // 2. Dedup against existing daily file
    const existingIds = new Set(dailyVideos.map(v => v.id));
    allCandidates = allCandidates.filter(v => {
        if (existingIds.has(v.id)) {
            log(`  [DEDUP] Already in daily: "${v.title}"`);
            return false;
        }
        return true;
    });
    log(`🔄 After daily dedup: ${allCandidates.length}`);

    // 3. Dedup against database
    if (allCandidates.length > 0) {
        try {
            const ids = allCandidates.map(v => v.id);
            const existingInDb = await Database.checkMultipleVideosExist(ids);
            if (existingInDb.size > 0) {
                allCandidates = allCandidates.filter(v => {
                    if (existingInDb.has(v.id)) {
                        log(`  [DB DEDUP] Already extracted: "${v.title}"`);
                        return false;
                    }
                    return true;
                });
                log(`🗄️ After DB dedup: ${allCandidates.length}`);
            }
        } catch (err) {
            log(`⚠️ DB dedup failed: ${err.message}`, 'warn');
        }
    }

    // ============ Filter Phase ============
    const filters = loadFilters();
    let keptVideos = allCandidates;

    if (allCandidates.length > 0 && (filters.block_list.length > 0 || filters.allow_list.length > 0)) {
        const filterResult = applyWeightedFilter(allCandidates, filters);
        keptVideos = filterResult.kept;
        log(`🔍 Filter: ${filterResult.stats.kept} kept, ${filterResult.stats.dropped} dropped`);
    }

    // ============ Enrich & Merge Phase ============
    const enriched = keptVideos.map(v => ({
        id: v.id,
        title: v.title,
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
        // V3 discovery fields
        source: 'discovery',
        tag: 'Discovery',
        discovery_query: v.discovery_query || '',
    }));

    // Merge into daily file
    const merged = [...dailyVideos, ...enriched];
    saveDailyFile(dateStr, merged);

    log(`========================================`);
    log(`✨ DISCOVERY COMPLETE`);
    log(`   🔎 Searches run: ${queries.length}`);
    log(`   📦 Raw candidates: ${seenIds.size}`);
    log(`   ✅ Kept after filter: ${enriched.length}`);
    log(`   📊 Daily file now: ${merged.length} videos`);
    log(`========================================`);

    return {
        success: true,
        searchesRun: queries.length,
        queries: queries,
        candidatesFound: seenIds.size,
        keptAfterFilter: enriched.length,
        addedToDaily: enriched.length,
        totalInDaily: merged.length,
        logs: collectedLogs
    };
}

// ============ CLI Entry Point ============
if (require.main === module) {
    const dateArg = process.argv[2] || null;
    runDiscovery(dateArg).then(result => {
        console.log('\n=== DISCOVERY RESULT ===');
        console.log(JSON.stringify(result, null, 2));
    }).catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { runDiscovery };
