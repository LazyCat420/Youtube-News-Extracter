# Youtube News Extracter

A Node.js tool to scrape YouTube videos for stock market news, extract their transcripts using Puppeteer, and save the data to a SQLite database. The data is structured to be easily consumed by an Ollama LLM for summarization or analysis.

## Features

- **YouTube Search**: Automatically finds videos based on keywords (default: "Stock Market News Today").
- **Transcript Extraction**: Uses Puppeteer to navigate video pages and extract the full transcript text.
- **Database Storage**: Saves video metadata and transcripts to a local `youtube_news.db` SQLite database.
- **Ollama Integration**: Includes a service to send transcripts to a local Ollama instance for AI processing.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/LazyCat420/Youtube-News-Extracter.git
   cd Youtube-News-Extracter
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

1. (Optional) Create a `.env` file to configure settings:
   ```env
   SEARCH_QUERY="Stock Market News Today"
   PROCESS_WITH_OLLAMA=true
   OLLAMA_URL="http://localhost:11434/api/generate"
   OLLAMA_MODEL="llama3"
   ```

2. Run the extractor:
   ```bash
   npm start
   ```

3. The script will:
   - Search YouTube for the query.
   - Scrape the top 3 videos.
   - Extract transcripts.
   - Save them to `youtube_news.db`.
   - (If enabled) Send to Ollama for summarization.

## Database Schema

The SQLite database `youtube_news.db` contains a `videos` table:

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary Key |
| video_id | TEXT | YouTube Video ID |
| title | TEXT | Video Title |
| url | TEXT | Video URL |
| description | TEXT | Video Description |
| transcript | TEXT | Full transcript text |
| scraped_at | DATETIME | Timestamp |
| processed_by_ollama | BOOLEAN | Flag for AI processing |

## Requirements

- Node.js
- Puppeteer (Chromium)
- SQLite3
- (Optional) [Ollama](https://ollama.ai) running locally for AI features.
