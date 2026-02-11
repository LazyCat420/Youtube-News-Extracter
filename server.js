require("dotenv").config();
const express = require("express");
const path = require("node:path");
const session = require("express-session");
const cron = require("node-cron");
const PuppeteerWrapper = require("./src/services/puppeteerWrapper");
const Database = require("./src/services/database");
const YouTubeAPIService = require("./services/youtube-api");

const app = express();
const PORT = process.env.PORT || 3010;

// Initialize YouTube API service (only if credentials are configured)
let youtubeService = null;
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
	youtubeService = new YouTubeAPIService(
		process.env.GOOGLE_CLIENT_ID,
		process.env.GOOGLE_CLIENT_SECRET,
		`http://localhost:${PORT}/auth/google/callback`,
	);
	console.log("✅ YouTube API service initialized");
} else {
	console.log("⚠️  YouTube API not configured - add credentials to .env file");
}

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Session middleware for OAuth
app.use(
	session({
		secret: process.env.SESSION_SECRET || "dev-secret-change-this",
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: false, // Set to true in production with HTTPS
			maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
		},
	}),
);

// Routes - Extract transcript (preview only, doesn't save)
app.post("/api/extract", async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({ error: "URL is required" });
	}

	try {
		console.log(`Processing URL: ${url}`);
		const result = await PuppeteerWrapper.scrapeURL(url);

		if (result?.transcript) {
			res.json({
				success: true,
				title: result.title,
				url: url,
				description: result.description,
				transcript: result.transcript,
			});
		} else {
			res.status(404).json({
				error:
					"No transcript found for this video. The uploader may have disabled captions.",
			});
		}
	} catch (error) {
		console.error("Extraction error:", error);
		res.status(500).json({ error: "Failed to extract transcript." });
	}
});

// Save video to database
app.post("/api/videos/save", async (req, res) => {
	const { title, url, description, transcript } = req.body;

	if (!url || !transcript) {
		return res.status(400).json({ error: "URL and transcript are required" });
	}

	try {
		const videoId = await Database.saveVideo({
			title,
			url,
			description,
			transcript,
		});
		res.json({
			success: true,
			id: videoId,
			message: "Video saved successfully!",
		});
	} catch (error) {
		console.error("Save error:", error);
		res.status(500).json({ error: "Failed to save video to database." });
	}
});

// Get all videos from database
app.get("/api/videos", async (_req, res) => {
	try {
		const videos = await Database.getAllVideos();
		res.json({ success: true, videos });
	} catch (error) {
		console.error("Fetch error:", error);
		res.status(500).json({ error: "Failed to fetch videos." });
	}
});

// Get single video by ID
app.get("/api/videos/:id", async (req, res) => {
	try {
		const video = await Database.getVideoById(req.params.id);
		if (video) {
			res.json({ success: true, video });
		} else {
			res.status(404).json({ error: "Video not found." });
		}
	} catch (error) {
		console.error("Fetch error:", error);
		res.status(500).json({ error: "Failed to fetch video." });
	}
});

// Delete video by ID
app.delete("/api/videos/:id", async (req, res) => {
	try {
		const result = await Database.deleteVideo(req.params.id);
		if (result.deleted) {
			res.json({ success: true, message: "Video deleted successfully!" });
		} else {
			res.status(404).json({ error: "Video not found." });
		}
	} catch (error) {
		console.error("Delete error:", error);
		res.status(500).json({ error: "Failed to delete video." });
	}
});

// ============ Settings & LLM Summarization Routes ============
const SETTINGS_FILE = path.join(__dirname, "config/settings.json");

function loadSettings() {
	try {
		const fs = require("node:fs");
		if (fs.existsSync(SETTINGS_FILE)) {
			return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
		}
	} catch (e) {
		console.error("Settings load error:", e.message);
	}
	return { ollama_endpoint: "http://10.0.0.30:11434", ollama_model: "" };
}

function saveSettings(settings) {
	const fs = require("node:fs");
	const dir = path.dirname(SETTINGS_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
}

// Get settings
app.get("/api/settings", (_req, res) => {
	res.json({ success: true, settings: loadSettings() });
});

// Save settings
app.post("/api/settings", (req, res) => {
	try {
		const { ollama_endpoint, ollama_model } = req.body;
		const settings = loadSettings();
		if (ollama_endpoint !== undefined)
			settings.ollama_endpoint = ollama_endpoint;
		if (ollama_model !== undefined) settings.ollama_model = ollama_model;
		saveSettings(settings);
		res.json({ success: true, settings });
	} catch (error) {
		console.error("Settings save error:", error);
		res.status(500).json({ error: "Failed to save settings." });
	}
});

// Proxy: Get Ollama model list
app.get("/api/ollama/models", async (_req, res) => {
	try {
		const settings = loadSettings();
		const endpoint = settings.ollama_endpoint || "http://10.0.0.30:11434";
		const response = await fetch(`${endpoint}/api/tags`);
		if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
		const data = await response.json();
		const models = (data.models || []).map((m) => ({
			name: m.name,
			size: m.size,
			modified: m.modified_at,
		}));
		res.json({ success: true, models });
	} catch (error) {
		console.error("Ollama model fetch error:", error.message);
		res.status(502).json({ error: `Cannot reach Ollama: ${error.message}` });
	}
});

// Summarize a single video
app.post("/api/summarize/:id", async (req, res) => {
	try {
		const video = await Database.getVideoById(req.params.id);
		if (!video) return res.status(404).json({ error: "Video not found" });
		if (!video.transcript || video.transcript.length < 50) {
			return res
				.status(400)
				.json({ error: "No transcript available to summarize" });
		}

		const settings = loadSettings();
		// Allow model override from request body (for Re-Summarize with different model)
		const model = req.body?.model || settings.ollama_model;
		if (!model) {
			return res
				.status(400)
				.json({ error: "No Ollama model selected. Configure in Settings." });
		}

		const endpoint = settings.ollama_endpoint || "http://10.0.0.30:11434";

		// Truncate transcript to ~4000 chars to stay within context
		const transcript = video.transcript.substring(0, 4000);

		console.log(
			`[LLM] Summarizing video ${video.id}: "${video.title}" with ${model}...`,
		);

		const ollamaResponse = await fetch(`${endpoint}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages: [
					{
						role: "system",
						content:
							'You are a concise news analyst. Summarize transcripts into clear bullet points. Be factual and concise. Use plain text bullet points starting with "• ".',
					},
					{
						role: "user",
						content: `Summarize this news video transcript in 5-8 bullet points:\n\nTitle: ${video.title}\n\nTranscript:\n${transcript}`,
					},
				],
				stream: false,
				options: { temperature: 0.3 },
			}),
		});

		if (!ollamaResponse.ok) {
			const errText = await ollamaResponse.text();
			throw new Error(`Ollama error ${ollamaResponse.status}: ${errText}`);
		}

		const result = await ollamaResponse.json();
		const summary = result.message?.content || "";

		if (!summary) {
			return res.status(500).json({ error: "LLM returned empty summary" });
		}

		// Save summary to database
		await Database.saveSummary(video.id, summary);
		console.log(
			`[LLM] Summary saved for video ${video.id} (${summary.length} chars)`,
		);

		res.json({ success: true, summary, videoId: video.id });
	} catch (error) {
		console.error("Summarize error:", error.message);
		res.status(500).json({ error: `Summarization failed: ${error.message}` });
	}
});

// Generate a News Report from recent summaries
app.post("/api/news-report", async (req, res) => {
	try {
		console.log("[News Report] Generating daily news report...");
		const hours = req.body?.hours || 24;

		let videos = await Database.getRecentSummarizedVideos(hours);
		let isRerun = false;

		// Fallback: if no unreported videos, include already-reported ones
		if (videos.length === 0) {
			videos = await Database.getRecentSummarizedVideos(hours, true);
			isRerun = true;
			if (videos.length > 0) {
				console.log(
					`[News Report] No new videos — re-generating from ${videos.length} previously reported videos`,
				);
			}
		}

		console.log(
			`[News Report] Found ${videos.length} summarized videos from last ${hours}h${isRerun ? " (re-run)" : ""}`,
		);

		if (videos.length === 0) {
			return res.status(400).json({
				error: `No summarized videos found from the last ${hours} hours.`,
			});
		}

		const settings = loadSettings();
		const model = settings.ollama_model;
		if (!model) {
			return res
				.status(400)
				.json({ error: "No Ollama model selected. Configure in Settings." });
		}

		const endpoint = settings.ollama_endpoint || "http://10.0.0.30:11434";

		// Today's date for the prompt (prevents hallucinated dates)
		const todayStr = new Date().toLocaleDateString("en-US", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
		});

		// ── Pass 1: Chunk & Extract ──
		// Build all video entries with their dates and source URLs
		const allEntries = videos.map((v) => {
			const scrapedDate = v.scraped_at
				? new Date(v.scraped_at).toLocaleDateString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
					})
				: "Unknown date";
			const sourceUrl =
				v.url ||
				(v.video_id ? `https://www.youtube.com/watch?v=${v.video_id}` : "");
			return `### ${v.title} (${scrapedDate})\nSource: ${sourceUrl}\n${v.summary}`;
		});

		// Split into chunks of ~4000 chars each
		const CHUNK_SIZE = 4000;
		const chunks = [];
		let currentChunk = "";
		for (const entry of allEntries) {
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

		console.log(
			`[News Report] Split ${videos.length} videos into ${chunks.length} chunk(s)`,
		);

		// Helper to call Ollama with 5-minute timeout + benchmark tracking
		const benchmarks = []; // Collect metrics for each LLM call
		async function callOllama(messages, stepName = "unknown") {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
			const startTime = Date.now();

			try {
				const resp = await fetch(`${endpoint}/api/chat`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model,
						messages,
						stream: false,
						options: { temperature: 0.3, num_ctx: 16384 },
					}),
					signal: controller.signal,
				});
				clearTimeout(timeoutId);

				if (!resp.ok) {
					const errText = await resp.text();
					throw new Error(`Ollama error ${resp.status}: ${errText}`);
				}
				const result = await resp.json();
				const elapsed = Date.now() - startTime;

				// Extract Ollama metrics
				const evalCount = result.eval_count || 0;
				const evalDuration = result.eval_duration || 0; // nanoseconds
				const promptEvalCount = result.prompt_eval_count || 0;
				const promptEvalDuration = result.prompt_eval_duration || 0;
				const tokPerSec =
					evalDuration > 0
						? (evalCount / (evalDuration / 1e9)).toFixed(1)
						: "N/A";
				const promptTokPerSec =
					promptEvalDuration > 0
						? (promptEvalCount / (promptEvalDuration / 1e9)).toFixed(1)
						: "N/A";

				const metric = {
					step: stepName,
					wallTimeMs: elapsed,
					evalTokens: evalCount,
					promptTokens: promptEvalCount,
					tokPerSec: parseFloat(tokPerSec) || 0,
					promptTokPerSec: parseFloat(promptTokPerSec) || 0,
				};
				benchmarks.push(metric);

				console.log(
					`[Benchmark] ${stepName} | ${elapsed}ms wall | ${evalCount} tokens generated @ ${tokPerSec} tok/s | ${promptEvalCount} prompt tokens @ ${promptTokPerSec} tok/s`,
				);

				return result.message?.content || "";
			} catch (err) {
				clearTimeout(timeoutId);
				if (err.name === "AbortError") {
					throw new Error("Ollama request timed out after 5 minutes");
				}
				throw err;
			}
		}

		// ── Pass 1: Extract bullet points from each chunk ──
		const extractedFacts = [];
		for (let i = 0; i < chunks.length; i++) {
			console.log(
				`[News Report] Extracting facts from chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`,
			);
			const facts = await callOllama(
				[
					{
						role: "system",
						content: `Today's date is ${todayStr}. You are a news analyst. For EVERY video listed, output exactly one bullet point: "- [key fact with specific names/figures] (Source: Video Title) [URL]". The URL is the Source link provided with each video. Do NOT skip any video. Do NOT merge videos together. Be concise — one sentence per video. Always include the source URL at the end in square brackets.`,
					},
					{
						role: "user",
						content: `Extract one bullet point per video from these summaries:\n\n${chunks[i]}`,
					},
				],
				`extract-chunk-${i + 1}`,
			);
			extractedFacts.push(facts);
			console.log(
				`[News Report] Chunk ${i + 1} extracted (${facts.length} chars)`,
			);
		}
		const allFacts = extractedFacts.join("\n");

		// ── Pass 2: Categorize bullets in small batches (LLM), merge in code ──
		const factLines = allFacts
			.split("\n")
			.filter((l) => l.trim().startsWith("-"));
		console.log(
			`[News Report] ${factLines.length} bullet points to categorize`,
		);

		// Define theme categories
		const THEMES = [
			"📈 Markets & Economy",
			"🏛️ Politics & Policy",
			"💻 Technology",
			"🌍 World News",
			"🏦 Banking & Finance",
			"⚡ Energy & Commodities",
			"🏠 Real Estate",
			"📰 General News",
		];

		// Tag each bullet with a theme in small batches
		const TAG_BATCH = 10;
		const taggedBullets = []; // { theme, bullet }

		for (let i = 0; i < factLines.length; i += TAG_BATCH) {
			const batch = factLines.slice(i, i + TAG_BATCH);
			const batchNum = Math.floor(i / TAG_BATCH) + 1;
			const totalBatches = Math.ceil(factLines.length / TAG_BATCH);
			console.log(
				`[News Report] Tagging batch ${batchNum}/${totalBatches} (${batch.length} bullets)...`,
			);

			const numbered = batch.map((b, idx) => `${idx + 1}. ${b}`).join("\n");
			const tagsRaw = await callOllama(
				[
					{
						role: "system",
						content: `You are a news categorizer. For each numbered bullet, reply with ONLY the number and one of these exact themes:\n${THEMES.join("\n")}\n\nFormat your response as:\n1: theme\n2: theme\netc.\n\nNothing else. Just number: theme pairs, one per line.`,
					},
					{
						role: "user",
						content: `Categorize each bullet:\n\n${numbered}`,
					},
				],
				`categorize-batch-${batchNum}`,
			);

			// Parse tags
			const tagLines = tagsRaw.split("\n").filter((l) => l.trim());
			for (let j = 0; j < batch.length; j++) {
				let theme = "📰 General News"; // fallback
				const tagLine = tagLines.find((t) => t.trim().startsWith(`${j + 1}`));
				if (tagLine) {
					const matchedTheme = THEMES.find((t) => tagLine.includes(t));
					if (matchedTheme) theme = matchedTheme;
				}
				taggedBullets.push({ theme, bullet: batch[j] });
			}
		}

		// ── Merge in code — group bullets by theme ──
		console.log(
			`[News Report] Grouping ${taggedBullets.length} bullets by theme (in code)...`,
		);
		const grouped = {};
		for (const { theme, bullet } of taggedBullets) {
			if (!grouped[theme]) grouped[theme] = [];
			grouped[theme].push(bullet);
		}

		// Build the report body in code
		let reportBody = "";
		for (const theme of THEMES) {
			if (grouped[theme] && grouped[theme].length > 0) {
				reportBody += `\n${theme}\n`;
				for (const bullet of grouped[theme]) {
					reportBody += `${bullet}\n`;
				}
			}
		}

		// ── One tiny LLM call: generate bottom-line summary ──
		const activeThemes = THEMES.filter(
			(t) => grouped[t] && grouped[t].length > 0,
		);
		const bulletCount = taggedBullets.length;
		console.log(`[News Report] Generating bottom-line summary...`);

		const bottomLine = await callOllama(
			[
				{
					role: "system",
					content: `Write a 2-sentence "🔑 Bottom Line" takeaway for a daily news briefing dated ${todayStr}. Be specific and professional.`,
				},
				{
					role: "user",
					content: `The briefing covered ${bulletCount} stories across these themes: ${activeThemes.join(", ")}. Write the bottom-line takeaway.`,
				},
			],
			"bottom-line",
		);

		// ── Build benchmark summary ──
		const totalWallMs = benchmarks.reduce((s, b) => s + b.wallTimeMs, 0);
		const totalEvalTokens = benchmarks.reduce((s, b) => s + b.evalTokens, 0);
		const totalPromptTokens = benchmarks.reduce(
			(s, b) => s + b.promptTokens,
			0,
		);
		const avgTokPerSec =
			benchmarks.length > 0
				? (
						benchmarks.reduce((s, b) => s + b.tokPerSec, 0) / benchmarks.length
					).toFixed(1)
				: "N/A";

		let benchmarkSection = `\n📊 Benchmarks\n`;
		benchmarkSection += `- Model: ${model}\n`;
		benchmarkSection += `- LLM Calls: ${benchmarks.length}\n`;
		benchmarkSection += `- Total Time: ${(totalWallMs / 1000).toFixed(1)}s\n`;
		benchmarkSection += `- Total Tokens: ${totalPromptTokens} prompt + ${totalEvalTokens} generated\n`;
		benchmarkSection += `- Avg Speed: ${avgTokPerSec} tok/s\n`;
		for (const b of benchmarks) {
			benchmarkSection += `- ${b.step}: ${(b.wallTimeMs / 1000).toFixed(1)}s | ${b.evalTokens} tok @ ${b.tokPerSec} tok/s\n`;
		}

		console.log(
			`[Benchmark] ═══ TOTAL ═══ ${benchmarks.length} calls | ${(totalWallMs / 1000).toFixed(1)}s | ${totalEvalTokens} tokens | avg ${avgTokPerSec} tok/s`,
		);

		// Assemble final report with benchmarks
		const report = `${todayStr} — Daily Intel Briefing\n${reportBody}\n🔑 Bottom Line\n${bottomLine}\n${benchmarkSection}`;

		if (!report) {
			return res.status(500).json({ error: "LLM returned empty report" });
		}

		console.log(
			`[News Report] ✅ Report generated (${report.length} chars) from ${videos.length} videos`,
		);

		// Save report to database for history
		const videoIds = videos.map((v) => v.video_id).filter(Boolean);
		const videoDbIds = videos.map((v) => v.id);
		const saved = await Database.saveReport(report, videos.length, videoIds);
		console.log(`[News Report] Saved as report #${saved.id}`);

		// Mark videos as reported so they won't appear in the next report
		await Database.markVideosReported(videoDbIds);
		console.log(`[News Report] Marked ${videoDbIds.length} videos as reported`);

		res.json({
			success: true,
			report,
			reportId: saved.id,
			videoCount: videos.length,
			hours,
			generatedAt: new Date().toISOString(),
			benchmarks: {
				model,
				totalTimeMs: totalWallMs,
				totalEvalTokens,
				totalPromptTokens,
				avgTokPerSec: parseFloat(avgTokPerSec) || 0,
				steps: benchmarks,
			},
		});
	} catch (error) {
		console.error("[News Report] Error:", error.message);
		res
			.status(500)
			.json({ error: `Report generation failed: ${error.message}` });
	}
});

// List all saved reports
app.get("/api/reports", async (_req, res) => {
	try {
		const reports = await Database.getAllReports();
		res.json({ success: true, reports });
	} catch (error) {
		console.error("[Reports] List error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

// Get a single report by ID
app.get("/api/reports/:id", async (req, res) => {
	try {
		const report = await Database.getReportById(req.params.id);
		if (!report) return res.status(404).json({ error: "Report not found" });
		res.json({ success: true, report });
	} catch (error) {
		console.error("[Reports] Get error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

// Delete a report
app.delete("/api/reports/:id", async (req, res) => {
	try {
		const result = await Database.deleteReport(req.params.id);
		res.json({ success: true, deleted: result.deleted });
	} catch (error) {
		console.error("[Reports] Delete error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

// Auto-Playlist Routes
const { generateDailyPlaylist } = require("./auto-yt-playlist/generate_daily");
const { runDiscovery } = require("./auto-yt-playlist/discover");
const CHANNELS_FILE = path.join(__dirname, "auto-yt-playlist/channels.json");
const FILTERS_FILE = path.join(__dirname, "auto-yt-playlist/filters.json");
const OUTPUT_DIR = path.join(__dirname, "auto-yt-playlist/output");
const fs = require("node:fs");

// Generate Playlist
app.post("/api/playlist/generate", async (_req, res) => {
	try {
		console.log("Triggering daily playlist generation...");
		// Note: This might take time, so we might want to run it async and return immediately?
		// For now, let's await it to provide feedback.
		const result = await generateDailyPlaylist();
		if (result) {
			res.json({ success: true, ...result });
		} else {
			res.json({
				success: true,
				message: "No new videos found today.",
				videoCount: 0,
			});
		}
	} catch (error) {
		console.error("Playlist generation error:", error);
		res.status(500).json({ error: "Failed to generate playlist." });
	}
});

// V3: Discovery Engine — find related videos from new sources
app.post("/api/playlist/discover", async (_req, res) => {
	try {
		console.log("✨ Triggering discovery engine...");
		const result = await runDiscovery();
		res.json({ success: true, ...result });
	} catch (error) {
		console.error("Discovery error:", error);
		res.status(500).json({ error: "Discovery engine failed." });
	}
});

// Add a term to block_list or allow_list in filters.json
app.post("/api/playlist/filters/add", (req, res) => {
	try {
		const { term, listType } = req.body;
		if (!term || !listType) {
			return res.status(400).json({ error: "Missing term or listType" });
		}
		if (!["block_list", "allow_list"].includes(listType)) {
			return res.status(400).json({ error: "Invalid listType" });
		}

		let filters = { block_list: [], allow_list: [], category_rules: {} };
		if (fs.existsSync(FILTERS_FILE)) {
			filters = JSON.parse(fs.readFileSync(FILTERS_FILE, "utf-8"));
		}

		const list = filters[listType] || [];
		const normalized = term.toLowerCase().trim();

		if (list.includes(normalized)) {
			return res.json({
				success: true,
				message: "Term already exists",
				term: normalized,
			});
		}

		list.push(normalized);
		filters[listType] = list;
		fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
		console.log(`🔒 Added "${normalized}" to ${listType}`);
		res.json({ success: true, term: normalized, listType });
	} catch (error) {
		console.error("Filter add error:", error);
		res.status(500).json({ error: "Failed to add filter term." });
	}
});

// Get Generated Playlists History
app.get("/api/playlist/history", async (_req, res) => {
	try {
		if (!fs.existsSync(OUTPUT_DIR)) {
			return res.json({ success: true, playlists: [] });
		}

		const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".json"));
		// Sort by filename desc (filenames are timestamp-based like 2026-02-05_22-47-02.json)
		const sortedFiles = files.sort((a, b) => b.localeCompare(a));

		const playlists = sortedFiles.map((file) => {
			const filePath = path.join(OUTPUT_DIR, file);
			const stats = fs.statSync(filePath);
			return {
				filename: file,
				createdAt: stats.birthtime,
				data: JSON.parse(fs.readFileSync(filePath, "utf-8")),
			};
		});

		res.json({ success: true, playlists });
	} catch (error) {
		console.error("History fetch error:", error);
		res.status(500).json({ error: "Failed to fetch playlist history." });
	}
});

// Delete Playlist
app.delete("/api/playlist/:filename", async (req, res) => {
	try {
		const filename = req.params.filename;
		// Basic validation to prevent traversal
		if (!filename || filename.includes("..") || !filename.endsWith(".json")) {
			return res.status(400).json({ error: "Invalid filename" });
		}

		const jsonPath = path.join(OUTPUT_DIR, filename);
		const mdPath = jsonPath.replace(".json", ".md");

		if (fs.existsSync(jsonPath)) {
			fs.unlinkSync(jsonPath);
		}
		if (fs.existsSync(mdPath)) {
			fs.unlinkSync(mdPath);
		}

		res.json({ success: true, message: "Playlist deleted." });
	} catch (error) {
		console.error("Playlist delete error:", error);
		res.status(500).json({ error: "Failed to delete playlist." });
	}
});

// Delete single video from playlist
app.delete("/api/playlist/:filename/video/:videoId", async (req, res) => {
	try {
		const { filename, videoId } = req.params;

		if (!filename || filename.includes("..") || !filename.endsWith(".json")) {
			return res.status(400).json({ error: "Invalid filename" });
		}

		const jsonPath = path.join(OUTPUT_DIR, filename);
		const mdPath = jsonPath.replace(".json", ".md");

		if (!fs.existsSync(jsonPath)) {
			return res.status(404).json({ error: "Playlist not found" });
		}

		// Read, filter, and save
		let videos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		const originalCount = videos.length;
		videos = videos.filter((v) => v.id !== videoId);

		if (videos.length === originalCount) {
			return res.status(404).json({ error: "Video not found in playlist" });
		}

		fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));

		// Regenerate markdown
		const mdContent = generateMarkdownFromVideos(videos);
		fs.writeFileSync(mdPath, mdContent);

		res.json({
			success: true,
			message: "Video removed",
			remainingCount: videos.length,
		});
	} catch (error) {
		console.error("Delete video error:", error);
		res.status(500).json({ error: "Failed to delete video." });
	}
});

// Helper to regenerate markdown
function generateMarkdownFromVideos(videos) {
	const lines = [
		"# Daily YouTube Playlist",
		"",
		`Generated: ${new Date().toISOString()}`,
		"",
		`Total videos: ${videos.length}`,
		"",
	];

	// Group by category
	const categories = {};
	videos.forEach((v) => {
		const cat = v.category || "other";
		if (!categories[cat]) categories[cat] = [];
		categories[cat].push(v);
	});

	const categoryEmojis = {
		finance: "🏦",
		sports: "🏈",
		cooking: "🍳",
		tech: "💻",
		news: "📰",
		other: "📦",
	};

	for (const [cat, catVideos] of Object.entries(categories)) {
		lines.push(
			`## ${categoryEmojis[cat] || "📺"} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
			"",
		);
		catVideos.forEach((v, i) => {
			lines.push(`${i + 1}. **${v.title}** - ${v.channelName}`);
			lines.push(`   - https://youtube.com/watch?v=${v.id}`);
		});
		lines.push("");
	}

	return lines.join("\n");
}

// Batch extract transcripts from playlist with SSE progress
app.get(
	"/api/playlist/:filename/extract-transcripts-stream",
	async (req, res) => {
		const { filename } = req.params;

		if (!filename || filename.includes("..") || !filename.endsWith(".json")) {
			return res.status(400).json({ error: "Invalid filename" });
		}

		const jsonPath = path.join(OUTPUT_DIR, filename);

		if (!fs.existsSync(jsonPath)) {
			return res.status(404).json({ error: "Playlist not found" });
		}

		// Set up SSE headers
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		const videos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		const total = videos.length;
		let successCount = 0;
		let failCount = 0;

		console.log(`Starting batch extraction for ${total} videos...`);

		// Send initial event
		res.write(`data: ${JSON.stringify({ type: "start", total })}\n\n`);

		for (let i = 0; i < videos.length; i++) {
			const video = videos[i];
			try {
				const url = `https://youtube.com/watch?v=${video.id}`;

				// Send progress event before processing
				res.write(
					`data: ${JSON.stringify({
						type: "progress",
						current: i + 1,
						total,
						title: video.title,
						status: "extracting",
					})}\n\n`,
				);

				console.log(`[${i + 1}/${total}] Extracting: ${video.title}`);

				const result = await PuppeteerWrapper.scrapeURL(url);

				if (result?.transcript) {
					// Save to database
					Database.saveVideo({
						title: video.title,
						url: url,
						description: result.description || "",
						transcript: result.transcript,
					});

					successCount++;
					res.write(
						`data: ${JSON.stringify({
							type: "progress",
							current: i + 1,
							total,
							title: video.title,
							status: "success",
						})}\n\n`,
					);
				} else {
					failCount++;
					res.write(
						`data: ${JSON.stringify({
							type: "progress",
							current: i + 1,
							total,
							title: video.title,
							status: "failed",
							error: "No transcript available",
						})}\n\n`,
					);
				}
			} catch (err) {
				console.error(`Error extracting ${video.id}:`, err.message);
				failCount++;
				res.write(
					`data: ${JSON.stringify({
						type: "progress",
						current: i + 1,
						total,
						title: video.title,
						status: "failed",
						error: err.message,
					})}\n\n`,
				);
			}
		}

		// Send completion event
		res.write(
			`data: ${JSON.stringify({
				type: "complete",
				success: successCount,
				failed: failCount,
				total,
			})}\n\n`,
		);

		res.end();
	},
);

// Keep the original POST endpoint for backwards compatibility
app.post("/api/playlist/:filename/extract-transcripts", async (req, res) => {
	try {
		const { filename } = req.params;

		if (!filename || filename.includes("..") || !filename.endsWith(".json")) {
			return res.status(400).json({ error: "Invalid filename" });
		}

		const jsonPath = path.join(OUTPUT_DIR, filename);

		if (!fs.existsSync(jsonPath)) {
			return res.status(404).json({ error: "Playlist not found" });
		}

		const videos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		const results = [];

		console.log(`Starting batch extraction for ${videos.length} videos...`);

		for (const video of videos) {
			try {
				const url = `https://youtube.com/watch?v=${video.id}`;
				console.log(`Extracting: ${video.title}`);

				const result = await PuppeteerWrapper.scrapeURL(url);

				if (result?.transcript) {
					// Save to database
					Database.saveVideo({
						title: video.title,
						url: url,
						description: result.description || "",
						transcript: result.transcript,
					});

					results.push({ id: video.id, success: true, title: video.title });
				} else {
					results.push({
						id: video.id,
						success: false,
						title: video.title,
						error: "No transcript",
					});
				}
			} catch (err) {
				console.error(`Error extracting ${video.id}:`, err.message);
				results.push({
					id: video.id,
					success: false,
					title: video.title,
					error: err.message,
				});
			}
		}

		const successCount = results.filter((r) => r.success).length;
		res.json({
			success: true,
			extracted: successCount,
			total: videos.length,
			results,
		});
	} catch (error) {
		console.error("Batch extraction error:", error);
		res.status(500).json({ error: "Failed to extract transcripts." });
	}
});

// Get Channels
app.get("/api/playlist/channels", async (_req, res) => {
	try {
		if (!fs.existsSync(CHANNELS_FILE)) {
			return res.json({ success: true, channels: [] });
		}
		const channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf-8"));
		res.json({ success: true, channels });
	} catch (error) {
		console.error("Channels fetch error:", error);
		res.status(500).json({ error: "Failed to fetch channels." });
	}
});

// Update Channels
app.post("/api/playlist/channels", async (req, res) => {
	const { channels } = req.body;
	if (!channels || !Array.isArray(channels)) {
		return res.status(400).json({ error: "Invalid channels data" });
	}

	try {
		fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
		res.json({ success: true, message: "Channels updated successfully." });
	} catch (error) {
		console.error("Channels update error:", error);
		res.status(500).json({ error: "Failed to update channels." });
	}
});

// ============ Filter Management Routes ============

// Get current filters
app.get("/api/playlist/filters", (_req, res) => {
	try {
		if (!fs.existsSync(FILTERS_FILE)) {
			return res.json({
				success: true,
				filters: { block_list: [], allow_list: [], category_rules: {} },
			});
		}
		const filters = JSON.parse(fs.readFileSync(FILTERS_FILE, "utf-8"));
		res.json({ success: true, filters });
	} catch (error) {
		console.error("Filters fetch error:", error);
		res.status(500).json({ error: "Failed to fetch filters." });
	}
});

// Update filters (full replacement)
app.post("/api/playlist/filters", (req, res) => {
	try {
		const { filters } = req.body;
		if (!filters) {
			return res.status(400).json({ error: "Filters data required" });
		}
		fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
		res.json({ success: true, message: "Filters updated." });
	} catch (error) {
		console.error("Filters update error:", error);
		res.status(500).json({ error: "Failed to update filters." });
	}
});

// Add a term to block_list or allow_list
app.post("/api/playlist/filters/add-term", (req, res) => {
	try {
		const { term, list } = req.body; // list = 'block_list' or 'allow_list'
		if (!term || !list || !["block_list", "allow_list"].includes(list)) {
			return res.status(400).json({
				error: "Valid term and list (block_list or allow_list) required",
			});
		}

		let filters = { block_list: [], allow_list: [], category_rules: {} };
		if (fs.existsSync(FILTERS_FILE)) {
			filters = JSON.parse(fs.readFileSync(FILTERS_FILE, "utf-8"));
		}

		const normalizedTerm = term.toLowerCase().trim();
		if (!filters[list].includes(normalizedTerm)) {
			filters[list].push(normalizedTerm);
			fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
			res.json({
				success: true,
				message: `Added "${normalizedTerm}" to ${list}`,
				filters,
			});
		} else {
			res.json({
				success: true,
				message: `"${normalizedTerm}" already in ${list}`,
				filters,
			});
		}
	} catch (error) {
		console.error("Add filter term error:", error);
		res.status(500).json({ error: "Failed to add filter term." });
	}
});

// Remove a term from block_list or allow_list
app.post("/api/playlist/filters/remove-term", (req, res) => {
	try {
		const { term, list } = req.body;
		if (!term || !list || !["block_list", "allow_list"].includes(list)) {
			return res.status(400).json({ error: "Valid term and list required" });
		}

		let filters = { block_list: [], allow_list: [], category_rules: {} };
		if (fs.existsSync(FILTERS_FILE)) {
			filters = JSON.parse(fs.readFileSync(FILTERS_FILE, "utf-8"));
		}

		const normalizedTerm = term.toLowerCase().trim();
		filters[list] = filters[list].filter((t) => t !== normalizedTerm);
		fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2));
		res.json({
			success: true,
			message: `Removed "${normalizedTerm}" from ${list}`,
			filters,
		});
	} catch (error) {
		console.error("Remove filter term error:", error);
		res.status(500).json({ error: "Failed to remove filter term." });
	}
});

// ============ Video Status Management ============

// Update video status within a daily file
app.patch("/api/playlist/:filename/video/:videoId/status", (req, res) => {
	try {
		const { filename, videoId } = req.params;
		const { status, blocked_term } = req.body;

		const validStatuses = ["pending", "approved", "extracted", "ignored"];
		if (!validStatuses.includes(status)) {
			return res.status(400).json({
				error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
			});
		}

		if (!filename || filename.includes("..") || !filename.endsWith(".json")) {
			return res.status(400).json({ error: "Invalid filename" });
		}

		const jsonPath = path.join(OUTPUT_DIR, filename);
		if (!fs.existsSync(jsonPath)) {
			return res.status(404).json({ error: "Daily file not found" });
		}

		const videos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		const video = videos.find((v) => v.id === videoId);
		if (!video) {
			return res.status(404).json({ error: "Video not found in playlist" });
		}

		video.status = status;

		// Track when video was ignored for 24h auto-clear
		if (status === "ignored") {
			video.ignored_at = new Date().toISOString();
		} else {
			delete video.ignored_at;
		}

		// Persist or clear the blocked_term
		if (blocked_term !== undefined && blocked_term !== null) {
			video.blocked_term = blocked_term;
		} else if (status === "pending") {
			// Restoring to pending clears the block metadata
			delete video.blocked_term;
		}

		fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));

		res.json({
			success: true,
			message: `Video status updated to ${status}`,
			video,
		});
	} catch (error) {
		console.error("Status update error:", error);
		res.status(500).json({ error: "Failed to update video status." });
	}
});

// ============ 24-Hour Ignored Auto-Clear ============
// Automatically resets ignored videos back to pending after 24 hours
function clearExpiredIgnored() {
	try {
		if (!fs.existsSync(OUTPUT_DIR)) return;

		const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".json"));
		const now = Date.now();
		const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
		let totalCleared = 0;

		for (const file of files) {
			const jsonPath = path.join(OUTPUT_DIR, file);
			const videos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
			let changed = false;

			videos.forEach((v) => {
				if (v.status === "ignored" && v.ignored_at) {
					const ignoredTime = new Date(v.ignored_at).getTime();
					if (now - ignoredTime >= TWENTY_FOUR_HOURS) {
						v.status = "pending";
						delete v.ignored_at;
						delete v.blocked_term;
						totalCleared++;
						changed = true;
					}
				}
			});

			if (changed) {
				fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));
			}
		}

		if (totalCleared > 0) {
			console.log(
				`[Auto-Clear] Reset ${totalCleared} expired ignored videos back to pending`,
			);
		}
	} catch (error) {
		console.error("[Auto-Clear] Error clearing expired ignored videos:", error);
	}
}

// Run on startup and then every hour
clearExpiredIgnored();
setInterval(clearExpiredIgnored, 60 * 60 * 1000);

// Bulk update video statuses
app.patch("/api/playlist/:filename/bulk-status", (req, res) => {
	try {
		const { filename } = req.params;
		const { videoIds, status } = req.body;

		const validStatuses = ["pending", "approved", "extracted", "ignored"];
		if (!validStatuses.includes(status)) {
			return res.status(400).json({ error: `Invalid status` });
		}

		if (!filename || filename.includes("..") || !filename.endsWith(".json")) {
			return res.status(400).json({ error: "Invalid filename" });
		}

		if (!Array.isArray(videoIds) || videoIds.length === 0) {
			return res.status(400).json({ error: "videoIds array required" });
		}

		const jsonPath = path.join(OUTPUT_DIR, filename);
		if (!fs.existsSync(jsonPath)) {
			return res.status(404).json({ error: "Daily file not found" });
		}

		const videos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		const idsSet = new Set(videoIds);
		let updated = 0;

		videos.forEach((v) => {
			if (idsSet.has(v.id)) {
				v.status = status;
				// Track when video was ignored for 24h auto-clear
				if (status === "ignored") {
					v.ignored_at = new Date().toISOString();
				} else {
					delete v.ignored_at;
				}
				updated++;
			}
		});

		fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));

		res.json({
			success: true,
			message: `Updated ${updated} videos to ${status}`,
			updated,
		});
	} catch (error) {
		console.error("Bulk status update error:", error);
		res.status(500).json({ error: "Failed to bulk update statuses." });
	}
});

// ============ Dev Controls ============

// Reset all video statuses to 'pending' across all daily files
app.post("/api/dev/reset-statuses", (_req, res) => {
	try {
		if (!fs.existsSync(OUTPUT_DIR)) {
			return res.json({
				success: true,
				message: "No output directory found",
				filesReset: 0,
			});
		}

		const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".json"));
		let totalReset = 0;
		let filesReset = 0;

		for (const file of files) {
			const jsonPath = path.join(OUTPUT_DIR, file);
			const videos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
			let changed = false;

			videos.forEach((v) => {
				if (v.status && v.status !== "pending") {
					v.status = "pending";
					delete v.blocked_term;
					totalReset++;
					changed = true;
				}
			});

			if (changed) {
				fs.writeFileSync(jsonPath, JSON.stringify(videos, null, 2));
				filesReset++;
			}
		}

		console.log(
			`[Dev] Reset ${totalReset} video statuses across ${filesReset} files`,
		);
		res.json({
			success: true,
			message: `Reset ${totalReset} videos across ${filesReset} files`,
			totalReset,
			filesReset,
		});
	} catch (error) {
		console.error("Dev reset error:", error);
		res.status(500).json({ error: "Failed to reset statuses." });
	}
});

// ============ YouTube OAuth Routes ============

// Check auth status
app.get("/api/auth/status", (req, res) => {
	if (!youtubeService) {
		return res.json({ configured: false, loggedIn: false });
	}

	if (req.session?.tokens) {
		res.json({
			configured: true,
			loggedIn: true,
			user: req.session.user || null,
		});
	} else {
		res.json({ configured: true, loggedIn: false });
	}
});

// Initiate Google OAuth
app.get("/auth/google", (_req, res) => {
	if (!youtubeService) {
		return res
			.status(503)
			.send("YouTube API not configured. Add credentials to .env file.");
	}

	const authUrl = youtubeService.getAuthUrl();
	res.redirect(authUrl);
});

// OAuth callback
app.get("/auth/google/callback", async (req, res) => {
	const { code, error } = req.query;

	if (error) {
		console.error("OAuth error:", error);
		return res.redirect("/?auth=error");
	}

	if (!code) {
		return res.redirect("/?auth=error");
	}

	try {
		const tokens = await youtubeService.getTokens(code);
		req.session.tokens = tokens;

		// Store tokens in service for this session
		youtubeService.setCredentials(tokens);

		// Get user info
		const userInfo = await youtubeService.getUserInfo();
		req.session.user = {
			email: userInfo.email,
			name: userInfo.name,
			picture: userInfo.picture,
		};

		console.log(`✅ User logged in: ${userInfo.email}`);
		res.redirect("/?auth=success");
	} catch (err) {
		console.error("OAuth callback error:", err);
		res.redirect("/?auth=error");
	}
});

// Logout
app.get("/auth/logout", (req, res) => {
	req.session.destroy();
	res.redirect("/?auth=logout");
});

// Save playlist to YouTube
app.post("/api/playlist/save-to-youtube", async (req, res) => {
	if (!youtubeService) {
		return res.status(503).json({ error: "YouTube API not configured" });
	}

	if (!req.session || !req.session.tokens) {
		return res
			.status(401)
			.json({ error: "Not logged in. Please login with Google first." });
	}

	const { title, videoIds, privacy = "private" } = req.body;

	if (!title || !videoIds || !Array.isArray(videoIds)) {
		return res.status(400).json({ error: "Title and videoIds array required" });
	}

	try {
		// Set credentials for this request
		youtubeService.setCredentials(req.session.tokens);

		const result = await youtubeService.createPlaylistWithVideos(
			title,
			videoIds,
			`Auto-generated playlist from YouTube News Extracter on ${new Date().toLocaleDateString()}`,
			privacy,
		);

		res.json({
			success: true,
			playlistId: result.playlist.id,
			playlistUrl: `https://www.youtube.com/playlist?list=${result.playlist.id}`,
			videosAdded: result.videosAdded,
			totalVideos: result.totalVideos,
		});
	} catch (error) {
		console.error("Save to YouTube error:", error);
		res
			.status(500)
			.json({ error: `Failed to save playlist to YouTube: ${error.message}` });
	}
});

// ============ Auto-Sync Scheduler ============
let scheduledTask = null;

function initScheduler() {
	const settings = loadSettings();
	// Stop any existing task
	if (scheduledTask) {
		scheduledTask.stop();
		scheduledTask = null;
		console.log("[Scheduler] Stopped previous cron job.");
	}

	if (!settings.auto_sync_enabled) {
		console.log("[Scheduler] Auto-sync is disabled.");
		return;
	}

	const schedule = settings.auto_sync_schedule || "0 6,12 * * *";
	if (!cron.validate(schedule)) {
		console.error(
			`[Scheduler] Invalid cron expression: "${schedule}". Scheduler not started.`,
		);
		return;
	}

	scheduledTask = cron.schedule(schedule, async () => {
		const now = new Date().toLocaleTimeString();
		console.log(`[Scheduler] ⏰ Auto-sync triggered at ${now}`);
		try {
			const syncResult = await generateDailyPlaylist();
			console.log(
				`[Scheduler] Sync complete: ${syncResult ? syncResult.videoCount : 0} videos`,
			);
		} catch (err) {
			console.error("[Scheduler] Sync failed:", err.message);
		}
		try {
			const discoverResult = await runDiscovery();
			console.log(
				`[Scheduler] Discovery complete: ${discoverResult.addedToDaily || 0} new videos`,
			);
		} catch (err) {
			console.error("[Scheduler] Discovery failed:", err.message);
		}
	});
	console.log(`[Scheduler] ✅ Auto-sync enabled with schedule: "${schedule}"`);
}

// Scheduler API routes
app.get("/api/scheduler", (_req, res) => {
	const settings = loadSettings();
	res.json({
		success: true,
		enabled: !!settings.auto_sync_enabled,
		schedule: settings.auto_sync_schedule || "0 6,12 * * *",
		running: !!scheduledTask,
	});
});

app.post("/api/scheduler", (req, res) => {
	try {
		const { enabled, schedule } = req.body;
		const settings = loadSettings();

		if (schedule !== undefined) {
			if (!cron.validate(schedule)) {
				return res
					.status(400)
					.json({ error: `Invalid cron expression: "${schedule}"` });
			}
			settings.auto_sync_schedule = schedule;
		}
		if (enabled !== undefined) {
			settings.auto_sync_enabled = !!enabled;
		}

		saveSettings(settings);
		initScheduler(); // Restart with new config

		res.json({
			success: true,
			enabled: !!settings.auto_sync_enabled,
			schedule: settings.auto_sync_schedule,
			running: !!scheduledTask,
		});
	} catch (error) {
		console.error("[Scheduler] Update error:", error.message);
		res.status(500).json({ error: error.message });
	}
});

// ============ One-Click Pipeline (Extract → Summarize → Report) ============
app.get("/api/pipeline/run/:filename", async (req, res) => {
	const { filename } = req.params;

	if (!filename || filename.includes("..") || !filename.endsWith(".json")) {
		return res.status(400).json({ error: "Invalid filename" });
	}

	const jsonPath = path.join(OUTPUT_DIR, filename);
	if (!fs.existsSync(jsonPath)) {
		return res.status(404).json({ error: "Playlist not found" });
	}

	// SSE headers
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders();

	const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

	try {
		const allVideos = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		// Only extract pending/approved videos (not already extracted or ignored)
		const toExtract = allVideos.filter(
			(v) => v.status === "pending" || v.status === "approved" || !v.status,
		);

		// ══════ PHASE 1: EXTRACT ══════
		sendEvent({ phase: "extract", type: "start", total: toExtract.length });
		let extractSuccess = 0,
			extractFail = 0;

		for (let i = 0; i < toExtract.length; i++) {
			const video = toExtract[i];
			sendEvent({
				phase: "extract",
				type: "progress",
				current: i + 1,
				total: toExtract.length,
				title: video.title,
			});

			try {
				// DB dedup: skip videos already extracted in a previous session
				const alreadyExists = await Database.checkVideoExists(video.id);
				if (alreadyExists) {
					const v = allVideos.find((x) => x.id === video.id);
					if (v && v.status !== "extracted") {
						v.status = "extracted";
						fs.writeFileSync(jsonPath, JSON.stringify(allVideos, null, 2));
					}
					extractSuccess++;
					sendEvent({
						phase: "extract",
						type: "progress",
						current: i + 1,
						total: toExtract.length,
						title: video.title,
						status: "skipped",
						reason: "Already in database",
					});
					continue;
				}

				const url = `https://youtube.com/watch?v=${video.id}`;
				const result = await PuppeteerWrapper.scrapeURL(url);

				if (result?.transcript) {
					await Database.saveVideo({
						title: video.title,
						url: url,
						description: result.description || "",
						transcript: result.transcript,
					});

					// Mark as extracted in daily file
					const v = allVideos.find((x) => x.id === video.id);
					if (v) v.status = "extracted";
					fs.writeFileSync(jsonPath, JSON.stringify(allVideos, null, 2));

					extractSuccess++;
					sendEvent({
						phase: "extract",
						type: "progress",
						current: i + 1,
						total: toExtract.length,
						title: video.title,
						status: "success",
					});
				} else {
					extractFail++;
					sendEvent({
						phase: "extract",
						type: "progress",
						current: i + 1,
						total: toExtract.length,
						title: video.title,
						status: "failed",
						error: "No transcript",
					});
				}
			} catch (err) {
				extractFail++;
				sendEvent({
					phase: "extract",
					type: "progress",
					current: i + 1,
					total: toExtract.length,
					title: video.title,
					status: "failed",
					error: err.message,
				});
			}
		}

		sendEvent({
			phase: "extract",
			type: "done",
			success: extractSuccess,
			failed: extractFail,
		});

		// ══════ PHASE 2: SUMMARIZE ══════
		const settings = loadSettings();
		const model = settings.ollama_model;
		const endpoint = settings.ollama_endpoint || "http://10.0.0.30:11434";

		if (!model) {
			sendEvent({
				phase: "summarize",
				type: "skip",
				reason: "No Ollama model configured",
			});
		} else {
			const dbVideos = await Database.getAllVideos();
			const unsummarized = dbVideos.filter(
				(v) => v.transcript_length > 50 && !v.summary,
			);

			sendEvent({
				phase: "summarize",
				type: "start",
				total: unsummarized.length,
			});
			let sumSuccess = 0,
				sumFail = 0;

			for (let i = 0; i < unsummarized.length; i++) {
				const vid = unsummarized[i];
				sendEvent({
					phase: "summarize",
					type: "progress",
					current: i + 1,
					total: unsummarized.length,
					title: vid.title,
				});

				try {
					const fullVideo = await Database.getVideoById(vid.id);
					const transcript = fullVideo.transcript.substring(0, 4000);

					const ollamaResp = await fetch(`${endpoint}/api/chat`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							model,
							messages: [
								{
									role: "system",
									content:
										'You are a concise news analyst. Summarize transcripts into clear bullet points. Be factual and concise. Use plain text bullet points starting with "• ".',
								},
								{
									role: "user",
									content: `Summarize this news video transcript in 5-8 bullet points:\n\nTitle: ${fullVideo.title}\n\nTranscript:\n${transcript}`,
								},
							],
							stream: false,
							options: { temperature: 0.3 },
						}),
					});

					if (!ollamaResp.ok) throw new Error(`Ollama ${ollamaResp.status}`);
					const result = await ollamaResp.json();
					const summary = result.message?.content || "";

					if (summary) {
						await Database.saveSummary(vid.id, summary);
						sumSuccess++;
						sendEvent({
							phase: "summarize",
							type: "progress",
							current: i + 1,
							total: unsummarized.length,
							title: vid.title,
							status: "success",
						});
					} else {
						sumFail++;
						sendEvent({
							phase: "summarize",
							type: "progress",
							current: i + 1,
							total: unsummarized.length,
							title: vid.title,
							status: "failed",
							error: "Empty summary",
						});
					}
				} catch (err) {
					sumFail++;
					sendEvent({
						phase: "summarize",
						type: "progress",
						current: i + 1,
						total: unsummarized.length,
						title: vid.title,
						status: "failed",
						error: err.message,
					});
				}
			}
			sendEvent({
				phase: "summarize",
				type: "done",
				success: sumSuccess,
				failed: sumFail,
			});
		}

		// ══════ PHASE 3: REPORT ══════
		sendEvent({ phase: "report", type: "start" });

		try {
			let videos = await Database.getRecentSummarizedVideos(24);

			// Fallback: if no unreported videos, include already-reported ones
			if (videos.length === 0) {
				videos = await Database.getRecentSummarizedVideos(24, true);
				if (videos.length > 0) {
					console.log(
						`[News Report] No new videos — re-generating from ${videos.length} previously reported videos`,
					);
				}
			}

			if (videos.length === 0) {
				sendEvent({
					phase: "report",
					type: "skip",
					reason: "No summarized videos found",
				});
			} else if (!model) {
				sendEvent({
					phase: "report",
					type: "skip",
					reason: "No Ollama model configured",
				});
			} else {
				const todayStr = new Date().toLocaleDateString("en-US", {
					weekday: "long",
					year: "numeric",
					month: "long",
					day: "numeric",
				});

				const allEntries = videos.map((v) => {
					const scrapedDate = v.scraped_at
						? new Date(v.scraped_at).toLocaleDateString("en-US", {
								month: "short",
								day: "numeric",
								year: "numeric",
							})
						: "Unknown date";
					const sourceUrl =
						v.url ||
						(v.video_id ? `https://www.youtube.com/watch?v=${v.video_id}` : "");
					return `### ${v.title} (${scrapedDate})\nSource: ${sourceUrl}\n${v.summary}`;
				});

				const CHUNK_SIZE = 4000;
				const chunks = [];
				let currentChunk = "";
				for (const entry of allEntries) {
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

				const pipelineBenchmarks = [];
				async function pipelineCallOllama(messages, stepName = "unknown") {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
					const startTime = Date.now();
					try {
						const resp = await fetch(`${endpoint}/api/chat`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								model,
								messages,
								stream: false,
								options: { temperature: 0.3, num_ctx: 16384 },
							}),
							signal: controller.signal,
						});
						clearTimeout(timeoutId);
						if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
						const r = await resp.json();
						const elapsed = Date.now() - startTime;

						const evalCount = r.eval_count || 0;
						const evalDuration = r.eval_duration || 0;
						const promptEvalCount = r.prompt_eval_count || 0;
						const promptEvalDuration = r.prompt_eval_duration || 0;
						const tokPerSec =
							evalDuration > 0
								? (evalCount / (evalDuration / 1e9)).toFixed(1)
								: "N/A";
						const promptTokPerSec =
							promptEvalDuration > 0
								? (promptEvalCount / (promptEvalDuration / 1e9)).toFixed(1)
								: "N/A";

						pipelineBenchmarks.push({
							step: stepName,
							wallTimeMs: elapsed,
							evalTokens: evalCount,
							promptTokens: promptEvalCount,
							tokPerSec: parseFloat(tokPerSec) || 0,
							promptTokPerSec: parseFloat(promptTokPerSec) || 0,
						});

						console.log(
							`[Benchmark] ${stepName} | ${elapsed}ms wall | ${evalCount} tokens generated @ ${tokPerSec} tok/s | ${promptEvalCount} prompt tokens @ ${promptTokPerSec} tok/s`,
						);

						return r.message?.content || "";
					} catch (e) {
						clearTimeout(timeoutId);
						throw e;
					}
				}

				// Pass 1: Extract facts
				const extractedFacts = [];
				for (let i = 0; i < chunks.length; i++) {
					sendEvent({
						phase: "report",
						type: "progress",
						step: "extracting-facts",
						current: i + 1,
						total: chunks.length,
					});
					const facts = await pipelineCallOllama(
						[
							{
								role: "system",
								content: `Today's date is ${todayStr}. You are a news analyst. For EVERY video listed, output exactly one bullet point: "- [key fact with specific names/figures] (Source: Video Title) [URL]". The URL is the Source link provided with each video. Do NOT skip any video. Always include the source URL at the end in square brackets.`,
							},
							{
								role: "user",
								content: `Extract one bullet point per video from these summaries:\n\n${chunks[i]}`,
							},
						],
						`extract-chunk-${i + 1}`,
					);
					extractedFacts.push(facts);
				}

				const allFacts = extractedFacts.join("\n");
				const THEMES = [
					"📈 Markets & Economy",
					"🏛️ Politics & Policy",
					"💻 Technology",
					"🌍 World News",
					"🏦 Banking & Finance",
					"⚡ Energy & Commodities",
					"🏠 Real Estate",
					"📰 General News",
				];

				const factLines = allFacts
					.split("\n")
					.filter((l) => l.trim().startsWith("-"));
				const TAG_BATCH = 10;
				const taggedBullets = [];

				for (let i = 0; i < factLines.length; i += TAG_BATCH) {
					const batch = factLines.slice(i, i + TAG_BATCH);
					sendEvent({
						phase: "report",
						type: "progress",
						step: "categorizing",
						current: Math.floor(i / TAG_BATCH) + 1,
						total: Math.ceil(factLines.length / TAG_BATCH),
					});
					const numbered = batch.map((b, idx) => `${idx + 1}. ${b}`).join("\n");
					const tagsRaw = await pipelineCallOllama(
						[
							{
								role: "system",
								content: `You are a news categorizer. For each numbered bullet, reply with ONLY the number and one of these exact themes:\n${THEMES.join("\n")}\n\nFormat: 1: theme\n2: theme\netc.`,
							},
							{
								role: "user",
								content: `Categorize each bullet:\n\n${numbered}`,
							},
						],
						`categorize-batch-${Math.floor(i / TAG_BATCH) + 1}`,
					);

					const tagLines = tagsRaw.split("\n").filter((l) => l.trim());
					for (let j = 0; j < batch.length; j++) {
						let theme = "📰 General News";
						const tagLine = tagLines.find((t) =>
							t.trim().startsWith(`${j + 1}`),
						);
						if (tagLine) {
							const matchedTheme = THEMES.find((t) => tagLine.includes(t));
							if (matchedTheme) theme = matchedTheme;
						}
						taggedBullets.push({ theme, bullet: batch[j] });
					}
				}

				const grouped = {};
				for (const { theme, bullet } of taggedBullets) {
					if (!grouped[theme]) grouped[theme] = [];
					grouped[theme].push(bullet);
				}

				let reportBody = "";
				for (const theme of THEMES) {
					if (grouped[theme] && grouped[theme].length > 0) {
						reportBody += `\n${theme}\n`;
						for (const bullet of grouped[theme]) reportBody += `${bullet}\n`;
					}
				}

				const activeThemes = THEMES.filter(
					(t) => grouped[t] && grouped[t].length > 0,
				);
				sendEvent({ phase: "report", type: "progress", step: "bottom-line" });
				const bottomLine = await pipelineCallOllama(
					[
						{
							role: "system",
							content: `Write a 2-sentence "🔑 Bottom Line" takeaway for a daily news briefing dated ${todayStr}. Be specific and professional.`,
						},
						{
							role: "user",
							content: `The briefing covered ${taggedBullets.length} stories across these themes: ${activeThemes.join(", ")}. Write the bottom-line takeaway.`,
						},
					],
					"bottom-line",
				);

				// Build benchmark summary
				const totalWallMs = pipelineBenchmarks.reduce(
					(s, b) => s + b.wallTimeMs,
					0,
				);
				const totalEvalTokens = pipelineBenchmarks.reduce(
					(s, b) => s + b.evalTokens,
					0,
				);
				const totalPromptTokens = pipelineBenchmarks.reduce(
					(s, b) => s + b.promptTokens,
					0,
				);
				const avgTokPerSec =
					pipelineBenchmarks.length > 0
						? (
								pipelineBenchmarks.reduce((s, b) => s + b.tokPerSec, 0) /
								pipelineBenchmarks.length
							).toFixed(1)
						: "N/A";

				let benchmarkSection = `\n📊 Benchmarks\n`;
				benchmarkSection += `- Model: ${model}\n`;
				benchmarkSection += `- LLM Calls: ${pipelineBenchmarks.length}\n`;
				benchmarkSection += `- Total Time: ${(totalWallMs / 1000).toFixed(1)}s\n`;
				benchmarkSection += `- Total Tokens: ${totalPromptTokens} prompt + ${totalEvalTokens} generated\n`;
				benchmarkSection += `- Avg Speed: ${avgTokPerSec} tok/s\n`;
				for (const b of pipelineBenchmarks) {
					benchmarkSection += `- ${b.step}: ${(b.wallTimeMs / 1000).toFixed(1)}s | ${b.evalTokens} tok @ ${b.tokPerSec} tok/s\n`;
				}

				console.log(
					`[Benchmark] ═══ TOTAL ═══ ${pipelineBenchmarks.length} calls | ${(totalWallMs / 1000).toFixed(1)}s | ${totalEvalTokens} tokens | avg ${avgTokPerSec} tok/s`,
				);

				const report = `${todayStr} — Daily Intel Briefing\n${reportBody}\n🔑 Bottom Line\n${bottomLine}\n${benchmarkSection}`;
				const videoIds = videos.map((v) => v.video_id).filter(Boolean);
				const videoDbIds = videos.map((v) => v.id);
				const saved = await Database.saveReport(
					report,
					videos.length,
					videoIds,
				);
				sendEvent({
					phase: "report",
					type: "done",
					reportId: saved.id,
					videoCount: videos.length,
					reportLength: report.length,
					benchmarks: {
						model,
						totalTimeMs: totalWallMs,
						totalEvalTokens,
						totalPromptTokens,
						avgTokPerSec: parseFloat(avgTokPerSec) || 0,
						steps: pipelineBenchmarks,
					},
				});

				// Mark videos as reported so they won't appear in the next report
				await Database.markVideosReported(videoDbIds);
			}
		} catch (err) {
			sendEvent({ phase: "report", type: "error", error: err.message });
		}

		// ══════ ALL DONE ══════
		sendEvent({ type: "pipeline-complete" });
	} catch (err) {
		sendEvent({ type: "pipeline-error", error: err.message });
	}

	res.end();
});

// Start Server
const server = app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
	console.log("Press Ctrl+C to stop the server.");
	// Initialize scheduler after server starts
	initScheduler();
});

// Force keep-alive (hack for Windows/npm issues)
setInterval(() => {}, 10000);

// Handle graceful shutdown
const shutdown = async () => {
	console.log("\nReceived kill signal, shutting down gracefully...");

	// Force exit if graceful shutdown fails
	setTimeout(() => {
		console.error(
			"Could not close connections in time, forcefully shutting down",
		);
		process.exit(1);
	}, 5000);

	// Close Database
	if (Database?.close) {
		try {
			Database.close();
			console.log("Database connection closed.");
		} catch (err) {
			console.error("Error closing database:", err);
		}
	}

	// Close Server
	server.close(() => {
		console.log("Server closed.");
		process.exit(0);
	});
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown); // Handle kill commands too
