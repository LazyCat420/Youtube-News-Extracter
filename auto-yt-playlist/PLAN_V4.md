# Auto-Playlist Master Plan (V4)

## Objective
A unified system to **Discover**, **Filter**, and **Extract** high-value news from YouTube with a "Daily Workspace" workflow.

---

## 1. The "Daily Workspace" (V2)
**Goal**: Transition from "file generation" to "daily curation".

-   **Single File**: `output/YYYY-MM-DD.json` acts as the single source of truth for the day.
-   **State Tracking**: Videos have status: `pending` → `approved` → `extracted`.
-   **Global Deduplication**: Check `youtube_news.db` before adding any video to avoid processing it twice.
-   **UI**: A dashboard to review the day's feed, delete junk, and trigger extraction.

## 2. Context & Filtering Engine (V2/V3)
**Goal**: Filter noise without blocking new information.

-   **Weighted Logic**:
    1.  **Allow List (VIP)**: If title has "Stock/Fed/Market", **KEEP** (even if it has banned words).
    2.  **Block List**: If title has "Prank/Reaction", **DELETE**.
    3.  **Neutral**: If neither, **KEEP** (Safety net for new topics).
-   **Feedback Loop**: UI allows adding words to these lists when deleting videos.

## 3. Discovery & Shorts Strategy (V3)
**Goal**: Expand the net and handle Shorts appropriately.

-   **Discovery Engine**:
    -   Take top keywords from Approved videos.
    -   Search YouTube for those keywords to find *new* channels.
    -   Tag results as `source: "discovery"`.
-   **Shorts Handling**:
    -   **Strict Filter**: Shorts *must* hit the Allow List to survive.
    -   **UI**: Segregate Shorts into a "Quick Hits" reel at the bottom.

## 4. Performance & AdBlock (V4)
**Goal**: Speed up scraping and prevent ads from breaking the pipeline.

### Traffic Control System
We will implement **Request Interception** in `puppeteerWrapper.js` to block traffic at the network layer.

**Logic:**
1.  **Block Resources**: Abort requests for `image`, `media`, `font`.
    -   *Result*: Instant page loads, minimal bandwidth usage.
2.  **Block Ad Domains**: Abort requests to `doubleclick.net`, `googleadservices.com`.
    -   *Result*: Ad video player never loads; "Skip Ad" logic becomes redundant.
3.  **Allow APIs**: Strictly allow `youtube.com/youtubei/v1/*` to ensure transcripts load.

### Code Implementation Plan
Modify `src/services/puppeteerWrapper.js`:

```javascript
// Enable Interception
await page.setRequestInterception(true);

page.on('request', (req) => {
    const resourceType = req.resourceType();
    const url = req.url();

    // Block Heavy Media (Speed)
    if (['image', 'media', 'font'].includes(resourceType)) {
        req.abort(); 
        return;
    }

    // Block Ad Trackers (Stability)
    if (url.includes('doubleclick') || url.includes('googleadservices')) {
        req.abort();
        return;
    }

    req.continue();
});
```

---

## Execution Order
1.  **Phase 1 (Core)**: Implement **Daily Workspace** (Dedupe + UI Status).
2.  **Phase 2 (Performance)**: Implement **AdBlock/Traffic Control** (Immediate speed boost).
3.  **Phase 3 (Logic)**: Implement **Weighted Filters** & **Shorts Segregation**.
4.  **Phase 4 (Expansion)**: Implement **Discovery Engine**.
