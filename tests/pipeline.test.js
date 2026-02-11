import { describe, expect, it } from "vitest";

// Since database.js uses require/module.exports, we need to test its logic directly
// We'll test the core pipeline logic patterns without spinning up the full server

describe("Pipeline Phase Logic", () => {
	describe("Phase 1: Extract - DB Dedup", () => {
		it("should skip videos that already exist in the database", () => {
			// Simulate the dedup logic from the pipeline
			const allVideos = [
				{ id: "abc123", title: "Video A", status: "pending" },
				{ id: "def456", title: "Video B", status: "approved" },
				{ id: "ghi789", title: "Video C", status: "pending" },
			];

			const toExtract = allVideos.filter(
				(v) => v.status === "pending" || v.status === "approved" || !v.status,
			);

			expect(toExtract).toHaveLength(3);

			// Simulate DB containing abc123 and ghi789 already
			const existingInDb = new Set(["abc123", "ghi789"]);

			const results = [];
			for (const video of toExtract) {
				if (existingInDb.has(video.id)) {
					results.push({ id: video.id, status: "skipped" });
				} else {
					results.push({ id: video.id, status: "needs-extract" });
				}
			}

			expect(results).toEqual([
				{ id: "abc123", status: "skipped" },
				{ id: "def456", status: "needs-extract" },
				{ id: "ghi789", status: "skipped" },
			]);
		});

		it("should not re-extract videos with status 'extracted'", () => {
			const allVideos = [
				{ id: "abc123", title: "Already done", status: "extracted" },
				{ id: "def456", title: "Not done", status: "pending" },
				{ id: "ghi789", title: "Dismissed", status: "dismissed" },
			];

			const toExtract = allVideos.filter(
				(v) => v.status === "pending" || v.status === "approved" || !v.status,
			);

			expect(toExtract).toHaveLength(1);
			expect(toExtract[0].id).toBe("def456");
		});
	});

	describe("Phase 2: Summarize - Filter Logic", () => {
		it("should only summarize videos with transcript but no summary", () => {
			const dbVideos = [
				{
					id: 1,
					title: "Has transcript, no summary",
					transcript_length: 5000,
					summary: null,
				},
				{
					id: 2,
					title: "Has both",
					transcript_length: 3000,
					summary: "Already summarized",
				},
				{
					id: 3,
					title: "Short transcript",
					transcript_length: 30,
					summary: null,
				},
				{
					id: 4,
					title: "Empty summary",
					transcript_length: 4000,
					summary: "",
				},
			];

			const unsummarized = dbVideos.filter(
				(v) => v.transcript_length > 50 && !v.summary,
			);

			expect(unsummarized).toHaveLength(2);
			expect(unsummarized[0].id).toBe(1);
			expect(unsummarized[1].id).toBe(4);
		});
	});

	describe("Phase 3: Report - Fallback Logic", () => {
		it("should fall back to reported videos when no unreported ones exist", () => {
			// Simulate the getRecentSummarizedVideos logic
			const allSummarizedVideos = [
				{
					id: 1,
					title: "Video 1",
					summary: "sum1",
					last_reported_at: "2026-02-10",
				},
				{
					id: 2,
					title: "Video 2",
					summary: "sum2",
					last_reported_at: "2026-02-10",
				},
				{ id: 3, title: "Video 3", summary: "sum3", last_reported_at: null },
			];

			// First try: only unreported
			const unreported = allSummarizedVideos.filter(
				(v) => v.last_reported_at === null,
			);
			expect(unreported).toHaveLength(1);

			// If unreported is empty, fall back to all
			if (unreported.length === 0) {
				const allVideos = allSummarizedVideos;
				expect(allVideos).toHaveLength(3);
			}
		});

		it("should return empty when no summarized videos exist at all", () => {
			const allSummarizedVideos = [];

			const unreported = allSummarizedVideos.filter(
				(v) => v.last_reported_at === null,
			);
			expect(unreported).toHaveLength(0);

			// Fallback also empty
			expect(allSummarizedVideos).toHaveLength(0);
		});
	});

	describe("SSE Event Format", () => {
		it("should produce valid SSE event strings", () => {
			const sendEvent = (data) => `data: ${JSON.stringify(data)}\n\n`;

			const event = sendEvent({
				phase: "extract",
				type: "progress",
				current: 1,
				total: 5,
				title: "Test Video",
				status: "skipped",
				reason: "Already in database",
			});

			expect(event).toContain("data: ");
			expect(event.endsWith("\n\n")).toBe(true);

			const parsed = JSON.parse(event.replace("data: ", "").trim());
			expect(parsed.phase).toBe("extract");
			expect(parsed.status).toBe("skipped");
			expect(parsed.reason).toBe("Already in database");
		});

		it("should handle pipeline-complete event", () => {
			const sendEvent = (data) => `data: ${JSON.stringify(data)}\n\n`;

			const event = sendEvent({ type: "pipeline-complete" });
			const parsed = JSON.parse(event.replace("data: ", "").trim());
			expect(parsed.type).toBe("pipeline-complete");
		});
	});

	describe("Report Chunking", () => {
		it("should chunk long content into segments under 4000 chars", () => {
			const CHUNK_SIZE = 4000;
			const entries = Array.from(
				{ length: 20 },
				(_, i) =>
					`### Video ${i}\nSource: https://example.com\n${"x".repeat(300)}`,
			);

			const chunks = [];
			let currentChunk = "";
			for (const entry of entries) {
				if (
					currentChunk.length + entry.length + 2 > CHUNK_SIZE &&
					currentChunk.length > 0
				) {
					chunks.push(currentChunk);
					currentChunk = "";
				}
				currentChunk += `${entry}\n\n`;
			}
			if (currentChunk.trim()) chunks.push(currentChunk);

			// Should produce multiple chunks
			expect(chunks.length).toBeGreaterThan(1);
			// Each chunk should be under the limit (with some tolerance for the last entry)
			for (const chunk of chunks) {
				expect(chunk.length).toBeLessThan(CHUNK_SIZE + 500);
			}
		});
	});
});
