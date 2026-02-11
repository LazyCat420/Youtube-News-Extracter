const sqlite3 = require("sqlite3").verbose();
const path = require("node:path");

const dbPath = path.resolve(__dirname, "../youtube_news.db");

const db = new sqlite3.Database(dbPath, (err) => {
	if (err) {
		console.error("Error opening database:", err.message);
	} else {
		console.log("Connected to the SQLite database.");
		initDb();
	}
});

function initDb() {
	db.run(`CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT UNIQUE,
        title TEXT,
        url TEXT,
        description TEXT,
        transcript TEXT,
        summary TEXT,
        scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_by_ollama BOOLEAN DEFAULT 0
    )`);

	// Migration: Add summary column if it doesn't exist
	db.run(`ALTER TABLE videos ADD COLUMN summary TEXT`, (err) => {
		// Ignore "duplicate column" error — means migration already ran
		if (err && !err.message.includes("duplicate column")) {
			console.error("Migration error:", err.message);
		}
	});

	// Reports table for persisting generated news reports
	db.run(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        video_count INTEGER DEFAULT 0,
        generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

	// Migration: Add last_reported_at to videos for report deduplication
	db.run(`ALTER TABLE videos ADD COLUMN last_reported_at DATETIME`, (err) => {
		if (err && !err.message.includes("duplicate column")) {
			console.error("Migration error (last_reported_at):", err.message);
		}
	});

	// Migration: Add video_ids to reports for audit trail
	db.run(`ALTER TABLE reports ADD COLUMN video_ids TEXT`, (err) => {
		if (err && !err.message.includes("duplicate column")) {
			console.error("Migration error (video_ids):", err.message);
		}
	});
}

const Database = {
	saveVideo(videoData) {
		return new Promise((resolve, reject) => {
			const sql = `INSERT OR IGNORE INTO videos (video_id, title, url, description, transcript) VALUES (?, ?, ?, ?, ?)`;
			const videoId = videoData.url.split("v=")[1]?.split("&")[0] || "unknown";

			db.run(
				sql,
				[
					videoId,
					videoData.title,
					videoData.url,
					videoData.description,
					videoData.transcript,
				],
				function (err) {
					if (err) {
						console.error("Error saving video:", err.message);
						reject(err);
					} else {
						console.log(`Video saved with ID: ${this.lastID}`);
						resolve(this.lastID);
					}
				},
			);
		});
	},

	getUnprocessedVideos() {
		return new Promise((resolve, reject) => {
			db.all(
				`SELECT * FROM videos WHERE processed_by_ollama = 0 AND transcript IS NOT NULL`,
				[],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				},
			);
		});
	},

	markProcessed(id) {
		db.run(`UPDATE videos SET processed_by_ollama = 1 WHERE id = ?`, [id]);
	},

	saveSummary(id, summary) {
		return new Promise((resolve, reject) => {
			db.run(
				`UPDATE videos SET summary = ?, processed_by_ollama = 1 WHERE id = ?`,
				[summary, id],
				function (err) {
					if (err) reject(err);
					else resolve({ updated: this.changes > 0 });
				},
			);
		});
	},

	getAllVideos() {
		return new Promise((resolve, reject) => {
			db.all(
				`SELECT id, video_id, title, url, scraped_at, 
                    SUBSTR(transcript, 1, 200) as transcript_preview,
                    LENGTH(transcript) as transcript_length,
                    summary, processed_by_ollama
                    FROM videos ORDER BY scraped_at DESC`,
				[],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				},
			);
		});
	},

	getVideoById(id) {
		return new Promise((resolve, reject) => {
			db.get(`SELECT * FROM videos WHERE id = ?`, [id], (err, row) => {
				if (err) reject(err);
				else resolve(row);
			});
		});
	},

	deleteVideo(id) {
		return new Promise((resolve, reject) => {
			db.run(`DELETE FROM videos WHERE id = ?`, [id], function (err) {
				if (err) reject(err);
				else resolve({ deleted: this.changes > 0 });
			});
		});
	},

	/**
	 * Check if a single video exists in the database by its YouTube video_id
	 * Used by the auto-playlist generator for deduplication
	 */
	checkVideoExists(videoId) {
		return new Promise((resolve, reject) => {
			db.get(
				`SELECT video_id FROM videos WHERE video_id = ?`,
				[videoId],
				(err, row) => {
					if (err) reject(err);
					else resolve(!!row);
				},
			);
		});
	},

	/**
	 * Check which video IDs from an array already exist in the database
	 * Returns a Set of existing video IDs for O(1) lookup
	 * Used for batch deduplication during playlist generation
	 */
	checkMultipleVideosExist(videoIds) {
		return new Promise((resolve, reject) => {
			if (!videoIds || videoIds.length === 0) {
				return resolve(new Set());
			}
			const placeholders = videoIds.map(() => "?").join(",");
			db.all(
				`SELECT video_id FROM videos WHERE video_id IN (${placeholders})`,
				videoIds,
				(err, rows) => {
					if (err) reject(err);
					else resolve(new Set(rows.map((r) => r.video_id)));
				},
			);
		});
	},

	/**
	 * Get all videos that have summaries from the last N hours
	 * By default, excludes videos already included in a previous report
	 * Set includeReported=true to include them (fallback for re-generation)
	 */
	getRecentSummarizedVideos(hours = 24, includeReported = false) {
		return new Promise((resolve, reject) => {
			const reportedFilter = includeReported
				? ""
				: "AND last_reported_at IS NULL";
			db.all(
				`SELECT id, video_id, title, url, summary, scraped_at 
                 FROM videos 
                 WHERE summary IS NOT NULL AND summary != '' 
                 AND scraped_at >= datetime('now', '-' || ? || ' hours')
                 ${reportedFilter}
                 ORDER BY scraped_at DESC`,
				[hours],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				},
			);
		});
	},

	/**
	 * Mark videos as reported so they won't appear in the next report
	 * Called after a report is successfully generated and saved
	 */
	markVideosReported(videoDbIds) {
		return new Promise((resolve, reject) => {
			if (!videoDbIds || videoDbIds.length === 0) return resolve();
			const placeholders = videoDbIds.map(() => "?").join(",");
			db.run(
				`UPDATE videos SET last_reported_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
				videoDbIds,
				function (err) {
					if (err) reject(err);
					else {
						console.log(`[Database] Marked ${this.changes} videos as reported`);
						resolve({ updated: this.changes });
					}
				},
			);
		});
	},

	// ============ Report CRUD ============

	saveReport(content, videoCount, videoIds = []) {
		return new Promise((resolve, reject) => {
			const videoIdsStr = videoIds.join(",");
			db.run(
				`INSERT INTO reports (content, video_count, video_ids) VALUES (?, ?, ?)`,
				[content, videoCount, videoIdsStr],
				function (err) {
					if (err) reject(err);
					else resolve({ id: this.lastID });
				},
			);
		});
	},

	getAllReports() {
		return new Promise((resolve, reject) => {
			db.all(
				`SELECT id, SUBSTR(content, 1, 150) as preview, video_count, generated_at
                 FROM reports ORDER BY generated_at DESC`,
				[],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				},
			);
		});
	},

	getReportById(id) {
		return new Promise((resolve, reject) => {
			db.get(`SELECT * FROM reports WHERE id = ?`, [id], (err, row) => {
				if (err) reject(err);
				else resolve(row);
			});
		});
	},

	deleteReport(id) {
		return new Promise((resolve, reject) => {
			db.run(`DELETE FROM reports WHERE id = ?`, [id], function (err) {
				if (err) reject(err);
				else resolve({ deleted: this.changes > 0 });
			});
		});
	},

	close() {
		db.close();
	},
};

module.exports = Database;
