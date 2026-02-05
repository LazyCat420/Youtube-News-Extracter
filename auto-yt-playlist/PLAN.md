# Auto YouTube Playlist Generator Plan

## Objective
Build a system to automatically generate daily YouTube playlists from a curated list of channels without requiring a YouTube account login. The system will:
1. **Fetch** latest videos from a list of user-defined channels.
2. **Filter** for videos published in the last 24 hours (or since last run).
3. **Generate** an anonymous "Untitled Playlist" link (using `watch_videos?video_ids=`) for easy viewing on PC/Obsidian.
4. **Export** a structured JSON file so the main `Youtube-News-Extracter` can scrape transcripts from these specific videos later.

---

## 1. Architecture & Workflow

### Directory Structure
We will create a dedicated folder `auto-yt-playlist/` to keep this logic modular.

```
Youtube-News-Extracter/
├── auto-yt-playlist/
│   ├── channels.json           # CONFIG: List of channels to track
│   ├── generate_daily.js       # SCRIPT: Main logic to fetch & build playlist
│   ├── state.json              # DATA: Tracks last-processed IDs to avoid dupes
│   └── output/                 # OUTPUT: Daily generated files
│       ├── 2023-10-27.md       # Link for Obsidian/User
│       └── 2023-10-27.json     # Metadata for the Extractor
├── index.js                    # EXISTING: Main scraper (needs update to read .json input)
└── package.json
```

### Core Technologies
- **Runtime**: Node.js (matches existing repo).
- **Fetcher**: `yt-dlp` (cli tool). It is far more reliable than scraping raw HTML or using the limited official API for this specific "latest videos" use case.
  - *Requirement*: User must have `yt-dlp` installed globally or locally.
- **Output**: Markdown (for user), JSON (for system).

---

## 2. Data Structures

### `channels.json`
User-editable list of channels.
```json
[
  {
    "name": "Bloomberg TV",
    "url": "https://www.youtube.com/@Bloomberg/videos",
    "include_shorts": false
  },
  {
    "name": "TechCrunch",
    "id": "UC...", 
    "url": "https://www.youtube.com/user/techcrunch"
  }
]
```

### `output/YYYY-MM-DD.json`
Structured list for the scraper to consume.
```json
[
  {
    "videoId": "dQw4w9WgXcQ",
    "title": "Market Update",
    "channel": "Bloomberg TV",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "duration": 600,
    "uploadDate": "2023-10-27"
  }
]
```

---

## 3. Implementation Steps

### Step 1: The Fetcher Script (`generate_daily.js`)
We need a script that spawns a child process to run `yt-dlp` for each channel.

**Logic:**
1. Read `channels.json`.
2. For each channel, run:
   ```bash
   yt-dlp --flat-playlist --dump-single-json --playlist-end 5 --skip-download "CHANNEL_URL"
   ```
   - `--flat-playlist`: Fetches metadata only (fast), no video download.
   - `--playlist-end 5`: Only look at the 5 most recent videos (optimization).
3. **Filtering**:
   - Parse the JSON output.
   - Keep videos where `upload_date` == Today (or within last 24h window).
   - Filter out Shorts if configured (check duration < 60s or URL pattern).
4. **Aggregation**: Collect all valid video objects into a master list.

### Step 2: The Anonymous Playlist Link
To create a playlist without an account, we use the undocumented `watch_videos` endpoint.

**Logic:**
1. Extract all `videoId`s from the aggregated list.
2. Join them with commas: `id1,id2,id3`.
3. Construct URL:
   ```
   https://www.youtube.com/watch_videos?video_ids=ID1,ID2,ID3,ID4
   ```
   *(Note: This creates an anonymous playlist. Limits usually around 50 videos per link. If >50, split into "Playlist Part 1", "Playlist Part 2").*

### Step 3: Output Generation
1. **Markdown File (`output/YYYY-MM-DD.md`)**:
   ```markdown
   # Daily News Playlist - 2023-10-27

   [▶️ Open Daily Playlist (PC)](https://www.youtube.com/watch_videos?video_ids=...)

   ## Videos Included:
   - **Bloomberg**: Market Crash Incoming? (10:00)
   - **TechCrunch**: AI News (5:20)
   ```
   *The user can symlink this folder to their Obsidian vault.*

2. **JSON File (`output/YYYY-MM-DD.json`)**:
   - Save the full array of video objects. This serves as the input for the extraction phase.

---

## 4. Integration with Main Scraper

The current `index.js` searches YouTube. We need to add a mode to `index.js` (or create `process_playlist.js`) to consume our specific list instead.

**Proposed Change to Extractor:**
Create a new entry point or flag:
`npm run extract-playlist -- --file=auto-yt-playlist/output/2023-10-27.json`

**Logic:**
1. Load the JSON file.
2. Iterate through each video object.
3. Skip the "Search YouTube" Puppeteer step.
4. Go directly to `page.goto(videoUrl)` logic.
5. Reuse existing `getTranscript` and DB insertion logic.
6. Tag these entries in the DB (maybe add a column `source_playlist` or just treat them as normal).

---

## 5. Potential Issues & Edge Cases
- **Shorts Detection**: `yt-dlp` metadata usually includes `duration` or `ie_key`. We need to filter `ie_key == 'YoutubeShorts'` if the user wants to avoid vertical video news.
- **Rate Limiting**: Running `yt-dlp` on 20 channels rapidly might trigger 429s. We should add a small `sleep(2000)` between channel fetches.
- **Link Length**: URL max length is ~2000 chars. ~11 chars per ID + commas. We can fit ~100 videos safely. If more, we must split.
- **Live Streams**: Active streams might break the "transcript" extractor if they don't have captions yet. We should filter `is_live: true`.

---

## 6. Action Plan Summary
1. `npm install date-fns` (helper for dates) or just use native JS.
2. Create `channels.json` dummy data.
3. Write `generate_daily.js`.
4. Test `yt-dlp` integration.
5. Create `process_playlist.js` to bridge the gap to the database.
