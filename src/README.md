# Source Code Documentation

This directory contains the core logic modules for the Youtube News Extracter.

## Files

### `puppeteerWrapper.js`

A wrapper around Puppeteer (with Stealth Plugin) to handle interactions with YouTube.

- **Functions:**
  - `searchYoutube(query)`: Searches YouTube for a given query and returns a list of video objects `{title, url}`.
  - `scrapeURL(url)`: Navigates to a specific video URL, bypasses consent/popups, expands the description, finds the transcript button, and extracts the transcript text.

### `database.js`

Handles the connection and operations with the SQLite database (`youtube_news.db`).

- **Features:**
  - Automatically initializes the `videos` table if it doesn't exist.
  - Provides methods to `saveVideo` and mark videos as processed.

### `ollamaService.js`

A service to interact with a locally running Ollama instance.

- **Functions:**
  - `summarize(text)`: Sends the provided text (transcript) to the configured Ollama model (e.g., Llama 3) to generate a summary with financial data points.
