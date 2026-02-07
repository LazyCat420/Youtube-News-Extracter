/**
 * Topic Dedup Module
 * Groups videos about the same news topic using signal-word extraction
 * and Jaccard similarity clustering.
 * 
 * HOW IT WORKS:
 * 1. Strip generic words (stop words + allow_list terms + YouTube noise)
 * 2. Extract "signal words" — the actual topic identifiers
 * 3. Compare signal words between videos using Jaccard similarity
 * 4. Group videos sharing 35%+ of signal words into clusters
 */

// English stop words — common words that carry no topic meaning
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'nor',
    'so', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it',
    'its', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'my', 'your',
    'his', 'her', 'our', 'their', 'what', 'which', 'who', 'whom', 'how',
    'when', 'where', 'why', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'only', 'own', 'same', 'just', 'now',
    'also', 'very', 'too', 'about', 'up', 'out', 'into', 'over', 'after',
    'before', 'between', 'under', 'again', 'here', 'there', 'as', 'any',
    'new', 'says', 'said', 'get', 'gets', 'got', 'go', 'goes', 'going',
    'come', 'comes', 'much', 'many', 'well', 'still', 'even', 'big',
    'look', 'make', 'makes', 'take', 'takes', 'talk', 'talks', 'know',
    'think', 'see', 'way', 'back', 'first', 'one', 'two', 'three'
]);

// YouTube noise — common title filler that doesn't indicate topic
const YT_NOISE = new Set([
    'breaking', 'live', 'update', 'watch', 'full', 'episode', 'podcast',
    'show', 'daily', 'weekly', 'wrap', 'recap', 'opinion', 'analysis',
    'exclusive', 'special', 'report', 'latest', 'today', 'tonight',
    'morning', 'evening', 'closing', 'bell', 'power', 'lunch', 'halt',
    'correction', 'balance', 'businessweek', 'television', 'tv'
]);

// Similarity threshold — videos sharing this fraction of signal words are clustered
const SIMILARITY_THRESHOLD = 0.35;
// Minimum signal words a video must have to be clusterable
const MIN_SIGNAL_WORDS = 2;

/**
 * Extract signal words from a video title.
 * Strips stop words, allow_list generics, YouTube noise, short tokens, and dates.
 * 
 * @param {string} title - The video title
 * @param {Set<string>} genericWords - Words from allow_list to strip
 * @returns {Set<string>} Signal words (lowercased, unique)
 */
function extractSignals(title, genericWords) {
    // Normalize: lowercase, remove punctuation (keep alphanumeric + spaces)
    const cleaned = title
        .toLowerCase()
        .replace(/[''""]/g, '')       // smart quotes
        .replace(/[^\w\s]/g, ' ')     // all punctuation → space
        .replace(/\s+/g, ' ')         // collapse spaces
        .trim();

    const tokens = cleaned.split(' ');
    const signals = new Set();

    for (const token of tokens) {
        // Skip empty, short tokens (1-2 chars), pure numbers under 4 digits
        if (!token || token.length <= 2) continue;
        if (/^\d{1,3}$/.test(token)) continue;
        // Skip date-like patterns (2026, 20260206, etc.)
        if (/^20\d{2,6}$/.test(token)) continue;

        // Skip stop words, generic words, and YouTube noise
        if (STOP_WORDS.has(token)) continue;
        if (genericWords.has(token)) continue;
        if (YT_NOISE.has(token)) continue;

        signals.add(token);
    }

    return signals;
}

/**
 * Compute Jaccard similarity between two sets.
 * Jaccard(A,B) = |A ∩ B| / |A ∪ B|
 * 
 * @param {Set<string>} a 
 * @param {Set<string>} b 
 * @returns {number} Similarity score between 0 and 1
 */
function jaccard(a, b) {
    if (a.size === 0 || b.size === 0) return 0;

    let intersection = 0;
    for (const word of a) {
        if (b.has(word)) intersection++;
    }

    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Cluster videos by topic similarity.
 * Returns an array where each element is a cluster (array of video objects).
 * Single-video clusters are returned as arrays of length 1.
 * 
 * @param {Array} videos - Array of video objects with at least { id, title }
 * @param {Array<string>} allowList - Generic terms from filters.json allow_list
 * @returns {{ clusters: Array<{ topic: string, videos: Array }>, signalMap: Object }}
 */
function clusterByTopic(videos, allowList = []) {
    // Build the set of generic words to strip (from allow_list)
    const genericWords = new Set();
    for (const term of allowList) {
        // Allow list can have multi-word terms like "interest rate"
        for (const word of term.toLowerCase().split(/\s+/)) {
            if (word.length > 2) genericWords.add(word);
        }
    }

    // Step 1: Extract signal words for each video
    const signalMap = {};
    for (const video of videos) {
        signalMap[video.id] = extractSignals(video.title || '', genericWords);
    }

    // Step 2: Greedy clustering
    const clusters = []; // Each cluster: { topic: string, videos: [video, ...] }
    const assigned = new Set();

    for (const video of videos) {
        if (assigned.has(video.id)) continue;

        const signals = signalMap[video.id];

        // Videos with too few signal words → unclustered (solo)
        if (signals.size < MIN_SIGNAL_WORDS) {
            clusters.push({
                topic: [...signals].join(' ') || video.title,
                videos: [video]
            });
            assigned.add(video.id);
            continue;
        }

        // Try to find a matching existing cluster
        let matched = false;
        for (const cluster of clusters) {
            if (cluster.videos.length === 0) continue;

            // Compare against the anchor (first video in cluster)
            const anchorId = cluster.videos[0].id;
            const anchorSignals = signalMap[anchorId];

            const similarity = jaccard(signals, anchorSignals);
            if (similarity >= SIMILARITY_THRESHOLD) {
                cluster.videos.push(video);
                assigned.add(video.id);
                matched = true;
                break;
            }
        }

        // No match found → create new cluster
        if (!matched) {
            clusters.push({
                topic: [...signals].join(' '),
                videos: [video]
            });
            assigned.add(video.id);
        }
    }

    return { clusters, signalMap };
}

// Export for use in app.js (loaded as a module in the browser)
// We use a global since this is a plain JS file loaded via <script>
if (typeof window !== 'undefined') {
    window.TopicDedup = { clusterByTopic, extractSignals, jaccard };
}
// For Node.js (testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { clusterByTopic, extractSignals, jaccard };
}
