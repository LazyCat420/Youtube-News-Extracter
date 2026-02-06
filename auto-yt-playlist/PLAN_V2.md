# Auto-Playlist V2: The "Daily Workspace" Plan

## Objective
Transition from a "file-based generator" to a **"Daily Workspace"** workflow.
Currently, running the generator multiple times creates multiple files (`2023-10-27_10-00.json`, `2023-10-27_14-00.json`). This creates clutter and manual management overhead.

**New Goal**: A single, living "Daily Dashboard" that handles:
1.  **Smart Merging**: Multiple runs in one day update the *same* list.
2.  **State Tracking**: Videos have a lifecycle (`pending` → `approved` → `extracted`).
3.  **Global Deduplication**: Never suggest a video that is already in the main `youtube_news.db`.

---

## 1. Architecture Changes

### A. The "Single Daily File" Rule
Instead of `YYYY-MM-DD_HH-MM-SS.json`, we will strictly use:
- `output/YYYY-MM-DD.json` (The Master List for the day)
- `output/YYYY-MM-DD.md` (The User Link)

**Logic in `generate_daily.js`**:
1.  Calculate today's filename (`2026-02-06.json`).
2.  Check if it exists.
    -   **Yes**: Load it into memory.
    -   **No**: Start with empty array `[]`.
3.  Fetch new videos from channels.
4.  **Dedupe**:
    -   Filter out videos already in the JSON.
    -   **CRITICAL**: Query `youtube_news.db` to filter out videos we *already extracted* in the past (even if not in today's JSON).
5.  Append *new, unique* videos to the array with status `pending`.
6.  Save back to `YYYY-MM-DD.json`.

### B. Data Structure Update
The JSON objects in `YYYY-MM-DD.json` will get new fields to track state:

```json
{
  "id": "dQw4w9WgXcQ",
  "title": "Market Crash?",
  "status": "pending",        // pending | approved | extracted | ignored
  "auto_extract": false,      // If true, UI can auto-trigger
  "added_at": "2026-02-06T14:30:00Z"
}
```

---

## 2. Implementation Steps

### Step 1: Database Deduplication Service
We need a helper in `server.js` or `generate_daily.js` to check if a video ID exists in SQLite.

**Action**:
- Add `checkVideoExists(videoId)` to `src/services/database.js`.
- Use this in `generate_daily.js` to silently skip already-processed news.

### Step 2: Smart Merge Logic (`generate_daily.js`)
Modify the main generation script:
- **Input**: `channels.json`, `youtube_news.db`, `output/TODAY.json`.
- **Process**:
  - `existingVideos = load(TODAY.json)`
  - `newVideos = fetch(channels)`
  - `uniqueVideos = newVideos.filter(v => !existingVideos.has(v.id) && !db.has(v.id))`
  - `merged = [...existingVideos, ...uniqueVideos]`
- **Output**: Overwrite `TODAY.json` and `TODAY.md`.

### Step 3: Frontend "Workspace" UI (`public/app.js`)
Upgrade the "Playlist" tab to be a workflow tool.

**New UI Sections inside the Playlist Card**:
1.  **"New / Pending" Group**:
    -   Videos just found.
    -   Bulk Actions: "Approve All", "Dismiss All".
2.  **"Ready to Extract" Group**:
    -   Videos approved but not yet scraped.
    -   Action: "Extract Transcripts" (Global button for this group).
3.  **"Completed" Group**:
    -   Videos successfully extracted to DB.
    -   Visual: Dimmed/Greyscale to reduce noise.

### Step 4: The "Sync" Button
Rename "Generate Playlist" to **"🔄 Sync Daily Feed"**.
-   It assumes "Update Today's List" behavior.
-   It provides feedback: *"Found 3 new videos. 12 already in database."*

---

## 3. Automation "Seamless" Features

### Auto-Approve / Auto-Extract
Add a toggle in `channels.json` (and UI):
-   `"auto_approve": true` → Videos skip "Pending" and go straight to "Ready".
-   `"auto_extract": true` → (Advanced) Server automatically queues Puppeteer job upon discovery (maybe v3 feature).

### One-Click "Do It All"
Add a "Run Workflow" button in the UI:
1.  **Sync** (Fetch & Merge).
2.  **Extract** (Process all 'pending/approved' items).
3.  **Report** (Show results).

---

## 4. Execution Plan (Immediate)
1.  **Database Helper**: Expose a generic `checkVideoExists` API endpoint or function.
2.  **Update Generator**: Refactor `generate_daily.js` to implement the "Smart Merge" logic (read today's file -> append -> save).
3.  **Update UI**: Modify `renderPlaylists` to visually distinguish `extracted` vs `pending` videos (using the existing `status` field logic if present, or inferring it by checking DB).

This approach turns the tool from a "Link Generator" into a "News Desk" where you curate the day's intake efficiently.
