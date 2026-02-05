const express = require('express');
const path = require('path');
const PuppeteerWrapper = require('./src/puppeteerWrapper');
const Database = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
