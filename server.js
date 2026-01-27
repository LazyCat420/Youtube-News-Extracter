const express = require('express');
const path = require('path');
const PuppeteerWrapper = require('./src/puppeteerWrapper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Routes
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
                description: result.description,
                transcript: result.transcript 
            });
        } else {
            res.status(404).json({ error: 'No transcript found for this video.' });
        }
    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).json({ error: 'Failed to extract transcript.' }); 
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
