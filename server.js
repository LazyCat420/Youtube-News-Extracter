require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PuppeteerWrapper = require('./src/services/puppeteerWrapper');
const Database = require('./src/services/database');
const YouTubeAPIService = require('./services/youtube-api');

const app = express();
const PORT = process.env.PORT || 3010;

// Initialize YouTube API service (only if credentials are configured)
let youtubeService = null;
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    youtubeService = new YouTubeAPIService(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `http://localhost:${PORT}/auth/google/callback`
    );
    console.log('✅ YouTube API service initialized');
} else {
    console.log('⚠️  YouTube API not configured - add credentials to .env file');
}

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Session middleware for OAuth
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
    }
}));

// Routes - Extract transcript (preview only, doesn't save)
app.post('/api/extract', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        console.log(`Processing URL: ${url}`);
        const result = await PuppeteerWrapper.scrapeURL(url);

        if (result && result.transcript) {
            res.json({
                success: true,
                title: result.title,
                url: url,
                description: result.description,
                transcript: result.transcript
            });
        } else {
            res.status(404).json({ error: 'No transcript found for this video. The uploader may have disabled captions.' });
        }
    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).json({ error: 'Failed to extract transcript.' });
    }
});

// Save video to database
app.post('/api/videos/save', async (req, res) => {
    const { title, url, description, transcript } = req.body;

    if (!url || !transcript) {
        return res.status(400).json({ error: 'URL and transcript are required' });
    }

    try {
        const videoId = await Database.saveVideo({ title, url, description, transcript });
        res.json({ success: true, id: videoId, message: 'Video saved successfully!' });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ error: 'Failed to save video to database.' });
    }
});

// Get all videos from database
app.get('/api/videos', async (req, res) => {
    try {
        const videos = await Database.getAllVideos();
        res.json({ success: true, videos });
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch videos.' });
    }
});

// Get single video by ID
app.get('/api/videos/:id', async (req, res) => {
    try {
        const video = await Database.getVideoById(req.params.id);
        if (video) {
            res.json({ success: true, video });
        } else {
            res.status(404).json({ error: 'Video not found.' });
        }
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch video.' });
    }
});

// Delete video by ID
app.delete('/api/videos/:id', async (req, res) => {
    try {
        const result = await Database.deleteVideo(req.params.id);
        if (result.deleted) {
            res.json({ success: true, message: 'Video deleted successfully!' });
        } else {
            res.status(404).json({ error: 'Video not found.' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete video.' });
    }
});

// Auto-Playlist Routes
const { generateDailyPlaylist } = require('./auto-yt-playlist/generate_daily');
const { runDiscovery } = require('./auto-yt-playlist/discover');
const CHANNELS_FILE = path.join(__dirname, 'auto-yt-playlist/channels.json');
const FILTERS_FILE = path.join(__dirname, 'auto-yt-playlist/filters.json');
const OUTPUT_DIR = path.join(__dirname, 'auto-yt-playlist/output');
const fs = require('fs');

// Generate Playlist
app.post('/api/playlist/generate', async (req, res) => {
    try {
        console.log('Triggering daily playlist generation...');
        // Note: This might take time, so we might want to run it async and return immediately?
        // For now, let's await it to provide feedback.
        const result = await generateDailyPlaylist();
        if (result) {
            res.json({ success: true, ...result });
        } else {
            res.json({ success: true, message: 'No new videos found today.', videoCount: 0 });
        }
    } catch (error) {
        console.error('Playlist generation error:', error);
        res.status(500).json({ error: 'Failed to generate playlist.' });
    }
});

// V3: Discovery Engine — find related videos from new sources
app.post('/api/playlist/discover', async (req, res) => {
    try {
        console.log('✨ Triggering discovery engine...');
        const result = await runDiscovery();
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Discovery error:', error);
        res.status(500).json({ error: 'Discovery engine failed.' });
    }
});

// Add a term to block_list or allow_list in filters.json
app.post('/api/playlist/filters/add', (req, res) => {
    try {
        const { term, listType } = req.body;
        if (!term || !listType) {
            return res.status(400).json({ error: 'Missing term or listType' });
        }
        if (!['block_list', 'allow_list'].includes(listType)) {
            return res.status(400).json({ error: 'Invalid listType' });
        }

        let filters = { block_list: [], allow_list: [], category_rules: {} };
        if (fs.existsSync(FILTERS_FILE)) {
            filters = JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8'));
        }

        const list = filters[listType] || [];
        const normalized = term.toLowerCase().trim();

        if (list.includes(normalized)) {
            return res.json({ success: true, message: 'Term already exists', term: normalized });
        }

        list.push(normalized);
        filters[listType] = list;
        fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
        console.log(`🔒 Added "${normalized}" to ${listType}`);
        res.json({ success: true, term: normalized, listType });
    } catch (error) {
        console.error('Filter add error:', error);
        res.status(500).json({ error: 'Failed to add filter term.' });
    }
});

// Get Generated Playlists History
app.get('/api/playlist/history', async (req, res) => {
    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            return res.json({ success: true, playlists: [] });
        }

        const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json'));
        // Sort by filename desc (filenames are timestamp-based like 2026-02-05_22-47-02.json)
        const sortedFiles = files.sort((a, b) => b.localeCompare(a));

        const playlists = sortedFiles.map(file => {
            const filePath = path.join(OUTPUT_DIR, file);
            const stats = fs.statSync(filePath);
            return {
                filename: file,
                createdAt: stats.birthtime,
                data: JSON.parse(fs.readFileSync(filePath, 'utf-8'))
            };
        });

        res.json({ success: true, playlists });
    } catch (error) {
        console.error('History fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch playlist history.' });
    }
});

// Delete Playlist
app.delete('/api/playlist/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        // Basic validation to prevent traversal
        if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const jsonPath = path.join(OUTPUT_DIR, filename);
        const mdPath = jsonPath.replace('.json', '.md');

        if (fs.existsSync(jsonPath)) {
            fs.unlinkSync(jsonPath);
        }
        if (fs.existsSync(mdPath)) {
            fs.unlinkSync(mdPath);
        }

        res.json({ success: true, message: 'Playlist deleted.' });
    } catch (error) {
        console.error('Playlist delete error:', error);
        res.status(500).json({ error: 'Failed to delete playlist.' });
    }
});

// Delete single video from playlist
app.delete('/api/playlist/:filename/video/:videoId', async (req, res) => {
    try {
        const { filename, videoId } = req.params;

        if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const jsonPath = path.join(OUTPUT_DIR, filename);
        const mdPath = jsonPath.replace('.json', '.md');

        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        // Read, filter, and save
        let videos = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const originalCount = videos.length;
        videos = videos.filter(v => v.id !== videoId);

        if (videos.length === originalCount) {
            return res.status(404).json({ error: 'Video not found in playlist' });
        }

        fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));

        // Regenerate markdown
        const mdContent = generateMarkdownFromVideos(videos);
        fs.writeFileSync(mdPath, mdContent);

        res.json({ success: true, message: 'Video removed', remainingCount: videos.length });
    } catch (error) {
        console.error('Delete video error:', error);
        res.status(500).json({ error: 'Failed to delete video.' });
    }
});

// Helper to regenerate markdown
function generateMarkdownFromVideos(videos) {
    const lines = ['# Daily YouTube Playlist', '', `Generated: ${new Date().toISOString()}`, '', `Total videos: ${videos.length}`, ''];

    // Group by category
    const categories = {};
    videos.forEach(v => {
        const cat = v.category || 'other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(v);
    });

    const categoryEmojis = {
        finance: '🏦',
        sports: '🏈',
        cooking: '🍳',
        tech: '💻',
        news: '📰',
        other: '📦'
    };

    for (const [cat, catVideos] of Object.entries(categories)) {
        lines.push(`## ${categoryEmojis[cat] || '📺'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`, '');
        catVideos.forEach((v, i) => {
            lines.push(`${i + 1}. **${v.title}** - ${v.channelName}`);
            lines.push(`   - https://youtube.com/watch?v=${v.id}`);
        });
        lines.push('');
    }

    return lines.join('\n');
}

// Batch extract transcripts from playlist with SSE progress
app.get('/api/playlist/:filename/extract-transcripts-stream', async (req, res) => {
    const { filename } = req.params;

    if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    const jsonPath = path.join(OUTPUT_DIR, filename);

    if (!fs.existsSync(jsonPath)) {
        return res.status(404).json({ error: 'Playlist not found' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const videos = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const total = videos.length;
    let successCount = 0;
    let failCount = 0;

    console.log(`Starting batch extraction for ${total} videos...`);

    // Send initial event
    res.write(`data: ${JSON.stringify({ type: 'start', total })}\n\n`);

    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        try {
            const url = `https://youtube.com/watch?v=${video.id}`;

            // Send progress event before processing
            res.write(`data: ${JSON.stringify({
                type: 'progress',
                current: i + 1,
                total,
                title: video.title,
                status: 'extracting'
            })}\n\n`);

            console.log(`[${i + 1}/${total}] Extracting: ${video.title}`);

            const result = await PuppeteerWrapper.scrapeURL(url);

            if (result && result.transcript) {
                // Save to database
                Database.saveVideo({
                    title: video.title,
                    url: url,
                    description: result.description || '',
                    transcript: result.transcript
                });

                successCount++;
                res.write(`data: ${JSON.stringify({
                    type: 'progress',
                    current: i + 1,
                    total,
                    title: video.title,
                    status: 'success'
                })}\n\n`);
            } else {
                failCount++;
                res.write(`data: ${JSON.stringify({
                    type: 'progress',
                    current: i + 1,
                    total,
                    title: video.title,
                    status: 'failed',
                    error: 'No transcript available'
                })}\n\n`);
            }
        } catch (err) {
            console.error(`Error extracting ${video.id}:`, err.message);
            failCount++;
            res.write(`data: ${JSON.stringify({
                type: 'progress',
                current: i + 1,
                total,
                title: video.title,
                status: 'failed',
                error: err.message
            })}\n\n`);
        }
    }

    // Send completion event
    res.write(`data: ${JSON.stringify({
        type: 'complete',
        success: successCount,
        failed: failCount,
        total
    })}\n\n`);

    res.end();
});

// Keep the original POST endpoint for backwards compatibility
app.post('/api/playlist/:filename/extract-transcripts', async (req, res) => {
    try {
        const { filename } = req.params;

        if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const jsonPath = path.join(OUTPUT_DIR, filename);

        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        const videos = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const results = [];

        console.log(`Starting batch extraction for ${videos.length} videos...`);

        for (const video of videos) {
            try {
                const url = `https://youtube.com/watch?v=${video.id}`;
                console.log(`Extracting: ${video.title}`);

                const result = await PuppeteerWrapper.scrapeURL(url);

                if (result && result.transcript) {
                    // Save to database
                    Database.saveVideo({
                        title: video.title,
                        url: url,
                        description: result.description || '',
                        transcript: result.transcript
                    });

                    results.push({ id: video.id, success: true, title: video.title });
                } else {
                    results.push({ id: video.id, success: false, title: video.title, error: 'No transcript' });
                }
            } catch (err) {
                console.error(`Error extracting ${video.id}:`, err.message);
                results.push({ id: video.id, success: false, title: video.title, error: err.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        res.json({
            success: true,
            extracted: successCount,
            total: videos.length,
            results
        });
    } catch (error) {
        console.error('Batch extraction error:', error);
        res.status(500).json({ error: 'Failed to extract transcripts.' });
    }
});

// Get Channels
app.get('/api/playlist/channels', async (req, res) => {
    try {
        if (!fs.existsSync(CHANNELS_FILE)) {
            return res.json({ success: true, channels: [] });
        }
        const channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8'));
        res.json({ success: true, channels });
    } catch (error) {
        console.error('Channels fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch channels.' });
    }
});

// Update Channels
app.post('/api/playlist/channels', async (req, res) => {
    const { channels } = req.body;
    if (!channels || !Array.isArray(channels)) {
        return res.status(400).json({ error: 'Invalid channels data' });
    }

    try {
        fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
        res.json({ success: true, message: 'Channels updated successfully.' });
    } catch (error) {
        console.error('Channels update error:', error);
        res.status(500).json({ error: 'Failed to update channels.' });
    }
});

// ============ Filter Management Routes ============

// Get current filters
app.get('/api/playlist/filters', (req, res) => {
    try {
        if (!fs.existsSync(FILTERS_FILE)) {
            return res.json({ success: true, filters: { block_list: [], allow_list: [], category_rules: {} } });
        }
        const filters = JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8'));
        res.json({ success: true, filters });
    } catch (error) {
        console.error('Filters fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch filters.' });
    }
});

// Update filters (full replacement)
app.post('/api/playlist/filters', (req, res) => {
    try {
        const { filters } = req.body;
        if (!filters) {
            return res.status(400).json({ error: 'Filters data required' });
        }
        fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
        res.json({ success: true, message: 'Filters updated.' });
    } catch (error) {
        console.error('Filters update error:', error);
        res.status(500).json({ error: 'Failed to update filters.' });
    }
});

// Add a term to block_list or allow_list
app.post('/api/playlist/filters/add-term', (req, res) => {
    try {
        const { term, list } = req.body; // list = 'block_list' or 'allow_list'
        if (!term || !list || !['block_list', 'allow_list'].includes(list)) {
            return res.status(400).json({ error: 'Valid term and list (block_list or allow_list) required' });
        }

        let filters = { block_list: [], allow_list: [], category_rules: {} };
        if (fs.existsSync(FILTERS_FILE)) {
            filters = JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8'));
        }

        const normalizedTerm = term.toLowerCase().trim();
        if (!filters[list].includes(normalizedTerm)) {
            filters[list].push(normalizedTerm);
            fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
            res.json({ success: true, message: `Added "${normalizedTerm}" to ${list}`, filters });
        } else {
            res.json({ success: true, message: `"${normalizedTerm}" already in ${list}`, filters });
        }
    } catch (error) {
        console.error('Add filter term error:', error);
        res.status(500).json({ error: 'Failed to add filter term.' });
    }
});

// Remove a term from block_list or allow_list
app.post('/api/playlist/filters/remove-term', (req, res) => {
    try {
        const { term, list } = req.body;
        if (!term || !list || !['block_list', 'allow_list'].includes(list)) {
            return res.status(400).json({ error: 'Valid term and list required' });
        }

        let filters = { block_list: [], allow_list: [], category_rules: {} };
        if (fs.existsSync(FILTERS_FILE)) {
            filters = JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf-8'));
        }

        const normalizedTerm = term.toLowerCase().trim();
        filters[list] = filters[list].filter(t => t !== normalizedTerm);
        fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
        res.json({ success: true, message: `Removed "${normalizedTerm}" from ${list}`, filters });
    } catch (error) {
        console.error('Remove filter term error:', error);
        res.status(500).json({ error: 'Failed to remove filter term.' });
    }
});

// ============ Video Status Management ============

// Update video status within a daily file
app.patch('/api/playlist/:filename/video/:videoId/status', (req, res) => {
    try {
        const { filename, videoId } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'approved', 'extracted', 'ignored'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const jsonPath = path.join(OUTPUT_DIR, filename);
        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: 'Daily file not found' });
        }

        let videos = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const video = videos.find(v => v.id === videoId);
        if (!video) {
            return res.status(404).json({ error: 'Video not found in playlist' });
        }

        video.status = status;
        fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));

        res.json({ success: true, message: `Video status updated to ${status}`, video });
    } catch (error) {
        console.error('Status update error:', error);
        res.status(500).json({ error: 'Failed to update video status.' });
    }
});

// Bulk update video statuses
app.patch('/api/playlist/:filename/bulk-status', (req, res) => {
    try {
        const { filename } = req.params;
        const { videoIds, status } = req.body;

        const validStatuses = ['pending', 'approved', 'extracted', 'ignored'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status` });
        }

        if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        if (!Array.isArray(videoIds) || videoIds.length === 0) {
            return res.status(400).json({ error: 'videoIds array required' });
        }

        const jsonPath = path.join(OUTPUT_DIR, filename);
        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: 'Daily file not found' });
        }

        let videos = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const idsSet = new Set(videoIds);
        let updated = 0;

        videos.forEach(v => {
            if (idsSet.has(v.id)) {
                v.status = status;
                updated++;
            }
        });

        fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));

        res.json({ success: true, message: `Updated ${updated} videos to ${status}`, updated });
    } catch (error) {
        console.error('Bulk status update error:', error);
        res.status(500).json({ error: 'Failed to bulk update statuses.' });
    }
});

// ============ YouTube OAuth Routes ============

// Check auth status
app.get('/api/auth/status', (req, res) => {
    if (!youtubeService) {
        return res.json({ configured: false, loggedIn: false });
    }

    if (req.session && req.session.tokens) {
        res.json({
            configured: true,
            loggedIn: true,
            user: req.session.user || null
        });
    } else {
        res.json({ configured: true, loggedIn: false });
    }
});

// Initiate Google OAuth
app.get('/auth/google', (req, res) => {
    if (!youtubeService) {
        return res.status(503).send('YouTube API not configured. Add credentials to .env file.');
    }

    const authUrl = youtubeService.getAuthUrl();
    res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/google/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
        console.error('OAuth error:', error);
        return res.redirect('/?auth=error');
    }

    if (!code) {
        return res.redirect('/?auth=error');
    }

    try {
        const tokens = await youtubeService.getTokens(code);
        req.session.tokens = tokens;

        // Store tokens in service for this session
        youtubeService.setCredentials(tokens);

        // Get user info
        const userInfo = await youtubeService.getUserInfo();
        req.session.user = {
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture
        };

        console.log(`✅ User logged in: ${userInfo.email}`);
        res.redirect('/?auth=success');
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.redirect('/?auth=error');
    }
});

// Logout
app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/?auth=logout');
});

// Save playlist to YouTube
app.post('/api/playlist/save-to-youtube', async (req, res) => {
    if (!youtubeService) {
        return res.status(503).json({ error: 'YouTube API not configured' });
    }

    if (!req.session || !req.session.tokens) {
        return res.status(401).json({ error: 'Not logged in. Please login with Google first.' });
    }

    const { title, videoIds, privacy = 'private' } = req.body;

    if (!title || !videoIds || !Array.isArray(videoIds)) {
        return res.status(400).json({ error: 'Title and videoIds array required' });
    }

    try {
        // Set credentials for this request
        youtubeService.setCredentials(req.session.tokens);

        const result = await youtubeService.createPlaylistWithVideos(
            title,
            videoIds,
            `Auto-generated playlist from YouTube News Extracter on ${new Date().toLocaleDateString()}`,
            privacy
        );

        res.json({
            success: true,
            playlistId: result.playlist.id,
            playlistUrl: `https://www.youtube.com/playlist?list=${result.playlist.id}`,
            videosAdded: result.videosAdded,
            totalVideos: result.totalVideos
        });
    } catch (error) {
        console.error('Save to YouTube error:', error);
        res.status(500).json({ error: 'Failed to save playlist to YouTube: ' + error.message });
    }
});

// Start Server
const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop the server.');
});

// Force keep-alive (hack for Windows/npm issues)
setInterval(() => { }, 10000);

// Handle graceful shutdown
const shutdown = async () => {
    console.log('\nReceived kill signal, shutting down gracefully...');

    // Force exit if graceful shutdown fails
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000);

    // Close Database
    if (Database && Database.close) {
        try {
            Database.close();
            console.log('Database connection closed.');
        } catch (err) {
            console.error('Error closing database:', err);
        }
    }

    // Close Server
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown); // Handle kill commands too
