const express = require('express');
const path = require('path');
const PuppeteerWrapper = require('./src/services/puppeteerWrapper');
const Database = require('./src/services/database');

const app = express();
const PORT = process.env.PORT || 3010;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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
const CHANNELS_FILE = path.join(__dirname, 'auto-yt-playlist/channels.json');
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

// Get Generated Playlists History
app.get('/api/playlist/history', async (req, res) => {
    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            return res.json({ success: true, playlists: [] });
        }

        const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json'));
        // Sort by modification time desc
        const playlists = files.map(file => {
            const filePath = path.join(OUTPUT_DIR, file);
            const stats = fs.statSync(filePath);
            return {
                filename: file,
                createdAt: stats.birthtime,
                data: JSON.parse(fs.readFileSync(filePath, 'utf-8'))
            };
        }).sort((a, b) => b.createdAt - a.createdAt);

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
