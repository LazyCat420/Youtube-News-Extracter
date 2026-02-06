# Auto-Playlist V3: Discovery & Context Engine

## Objective
This update addresses two critical limitations:
1.  **Echo Chamber**: We only see news from subscribed channels. We need a "Discovery Engine" to find relevant news from *new* sources.
2.  **Shorts Spam**: YouTube Shorts often lack deep context compared to long-form videos.

---

## 1. Discovery Engine (Expanding the Net)

Since YouTube deprecated the `relatedToVideoId` API endpoint in 2023, we cannot simply ask "What is related to this video?". We must build our own **Keyword-Based Discovery**.

### The "Topic Graph" Strategy
Instead of blindly searching, we use the *strongest* signals from our **Approved Videos**.

**Logic Flow (`discover_related.js`):**
1.  **Input**: The list of today's *Approved* videos (from `output/TODAY.json`).
2.  **Extract Keywords**:
    -   Take the title of each approved video.
    -   Remove "stop words" (the, a, is, on).
    -   Extract high-value terms (e.g., "Nvidia", "CPI Data", "Powell", "Rate Cut").
3.  **Search (Limited)**:
    -   Perform 3-5 targeted YouTube Searches using `yt-dlp "ytsearch5:KEYWORD"` (searches for top 5 videos for that keyword).
    -   *Why `yt-dlp`?* It scrapes the search results page, avoiding API quotas and finding the actual "algorithm" results.
4.  **Filter & Merge**:
    -   Apply the **Anti-Clickbait Filter** (from V2) to these new candidates.
    -   **Crucial**: Mark these videos as `source: "discovery"` in the UI so the user knows they are suggestions.

### The "Follow-Up" Query System
When the transcripts are extracted, we can (in a future V4) use the LLM to generate "Investigation Queries" like *"What did Analyst X say about Tesla?"*. For now, we stick to **Title-Based Keyword Extraction** which is deterministic and fast.

---

## 2. Handling YouTube Shorts vs. Long-Form

Shorts are high-volume but low-context. We need to treat them differently, not just ban them.

### Strategy: "Context Tiering"
We will classify videos into Tiers based on duration.

-   **Tier A (Deep Dive)**: > 5 minutes.
    -   *Action*: Full transcript extraction + High priority in playlist.
-   **Tier B (Update)**: 1 - 5 minutes.
    -   *Action*: Standard extraction.
-   **Tier C (Shorts)**: < 1 minute.
    -   *Action*: **"Digest Mode"**.
    -   Instead of creating a new DB entry for *every* short, we can (optionally) group them or flag them visually.

### Implementation: "Shorts Container"
In the UI, instead of cluttering the main list with 50 shorts, we create a **"Shorts Reel"** section at the bottom.
-   **Filter Config**: Add `"shorts_strategy": "separate"` to `channels.json`.
-   **Visual**: In `app.js`, render Shorts in a horizontal scrolling row, separate from the main "Deep Dive" news list.
-   **Auto-Reject**: If a Short doesn't match the *Allow List* (Finance) exactly, it gets auto-rejected (stricter rules for Shorts than long-form).

---

## 3. Updated Execution Plan

### Step 1: The Discovery Script
Create `auto-yt-playlist/discover.js`:
-   Reads `output/TODAY.json`.
-   Selects top 3 "Approved" videos.
-   Generates search queries: `ytsearch3:"{Title Keywords}"`.
-   Runs `yt-dlp` to fetch results.
-   Appends unique results to `TODAY.json` with `status: "pending"` and `tag: "Discovery"`.

### Step 2: Shorts Logic Update (`generate_daily.js`)
-   Use `yt-dlp`'s `duration` field.
-   Add field `is_short: true` if duration < 60s.
-   Apply **Strict Filtering**: Shorts *must* hit a high-value keyword to survive.

### Step 3: UI Update
-   Add **"✨ Suggested"** badge to discovery videos.
-   Move Shorts to a separate "Quick Hits" container in the playlist card.

This approach solves the "Echo Chamber" by actively searching for topics you already showed interest in, and solves "Shorts Spam" by segregating and strictly filtering them.
