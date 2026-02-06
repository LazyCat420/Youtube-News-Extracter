# Auto-Playlist V2: The "Daily Workspace" Plan

## Objective
Transition from a "file-based generator" to a **"Daily Workspace"** workflow.
Currently, running the generator multiple times creates multiple files (`2023-10-27_10-00.json`, `2023-10-27_14-00.json`). This creates clutter and manual management overhead.

**New Goal**: A single, living "Daily Dashboard" that handles:
1.  **Smart Merging**: Multiple runs in one day update the *same* list.
2.  **State Tracking**: Videos have a lifecycle (`pending` → `approved` → `extracted`).
3.  **Global Deduplication**: Never suggest a video that is already in the main `youtube_news.db`.
4.  **Smart Filtering (Anti-Clickbait)**: A logic-based system to filter noise without using expensive LLMs.

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
5.  **Filter**: Apply the new **Weighted Keyword Logic** (see Section 3).
6.  Append *new, unique* videos to the array with status `pending`.
7.  Save back to `YYYY-MM-DD.json`.

### B. Data Structure Update
The JSON objects in `YYYY-MM-DD.json` will get new fields to track state:

```json
{
  "id": "dQw4w9WgXcQ",
  "title": "Taylor Swift loves Spotify Stock?",
  "status": "pending",        // pending | approved | extracted | ignored
  "auto_extract": false,      // If true, UI can auto-trigger
  "filter_score": 5,          // Debugging: why was this kept?
  "added_at": "2026-02-06T14:30:00Z"
}
```

We also need a new config file: `filters.json`.
```json
{
  "block_list": ["taylor swift", "reaction", "prank", "gameplay"],
  "allow_list": ["stock", "market", "finance", "spotify", "earnings", "fed"],
  "category_rules": {
    "finance": { "allow_list_weight": 2.0 },
    "tech": { "allow_list_weight": 1.5 }
  }
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
- **Input**: `channels.json`, `youtube_news.db`, `output/TODAY.json`, `filters.json`.
- **Process**:
  - `existingVideos = load(TODAY.json)`
  - `newVideos = fetch(channels)`
  - `uniqueVideos = newVideos.filter(v => !existingVideos.has(v.id) && !db.has(v.id))`
  - `filteredVideos = applyWeightedFilter(uniqueVideos)` // NEW
  - `merged = [...existingVideos, ...filteredVideos]`
- **Output**: Overwrite `TODAY.json` and `TODAY.md`.

### Step 3: Frontend "Workspace" UI (`public/app.js`)
Upgrade the "Playlist" tab to be a workflow tool.

**New UI Sections inside the Playlist Card**:
1.  **"New / Pending" Group**:
    -   Videos just found.
    -   Bulk Actions: "Approve All", "Dismiss All".
    -   **"Trash & Block"**: When deleting, offer a prompt: *"Block phrase in future?"* -> updates `filters.json`.
2.  **"Ready to Extract" Group**:
    -   Videos approved but not yet scraped.
    -   Action: "Extract Transcripts" (Global button for this group).
3.  **"Completed" Group**:
    -   Videos successfully extracted to DB.
    -   Visual: Dimmed/Greyscale to reduce noise.

### Step 4: The "Sync" Button
Rename "Generate Playlist" to **"🔄 Sync Daily Feed"**.
-   It assumes "Update Today's List" behavior.
-   It provides feedback: *"Found 3 new videos. 12 already in database. 5 blocked by filters."*

---

## 3. The Weighted Keyword Logic (Anti-Clickbait)

We avoid complex LLMs by using a **Score-Based Hierarchy**.

**The Logic Flow (`applyWeightedFilter`):**

1.  **Normalization**: Convert Title + Description (if avail) to lowercase.
2.  **Check 1: Hard Allow (The "Finance Override")**:
    -   Does the text contain a word from `allow_list`?
    -   *If YES*: The video is **KEPT**, even if it contains blocked words.
    -   *Example*: "Taylor Swift creates Spotify Stock Rally"
        -   "Taylor Swift" is blocked.
        -   "Stock" is allowed.
        -   **Result**: KEPT (Finance context > Celebrity noise).
3.  **Check 2: Hard Block**:
    -   (Only runs if Check 1 failed).
    -   Does the text contain a word from `block_list`?
    -   *If YES*: The video is **DROPPED**.
    -   *Example*: "Taylor Swift concert reaction"
        -   "Taylor Swift" is blocked.
        -   No finance words found.
        -   **Result**: DROPPED.
4.  **Check 3: Neutral**:
    -   If neither list is hit, keep the video (default to permissible).

**Data Persistence for User Feedback:**
-   **UI Action**: User deletes a video -> Prompt: "Why?" -> "Block topic 'Minecraft'".
-   **Backend**: Adds "minecraft" to `filters.json` -> `block_list`.
-   **Next Run**: "Minecraft" videos are automatically dropped unless they mention "Stock" or "Market".

**Refining the Logic (Category Weights)**:
-   If `categorizeVideo()` returns 'finance', we can be more lenient with the block list (maybe require 2 blocked words to ban).
-   If `categorizeVideo()` returns 'other', we strictly enforce the block list.

---

## 4. Execution Plan (Immediate)
1.  **Create `filters.json`**: Populate with initial finance terms and common clickbait terms.
2.  **Implement `applyWeightedFilter()`**: Add this function to `generate_daily.js`.
3.  **UI Feedback Loop**: Add the "Block this phrase" input to the delete modal in `public/app.js`.

This system provides "Context" without "AI". The `allow_list` acts as the context anchor ("If this is here, it's relevant"), while the `block_list` acts as the noise filter.
