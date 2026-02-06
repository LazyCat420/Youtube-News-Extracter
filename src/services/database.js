const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../youtube_news.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
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
        scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_by_ollama BOOLEAN DEFAULT 0
    )`);
}

const Database = {
    saveVideo(videoData) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT OR IGNORE INTO videos (video_id, title, url, description, transcript) VALUES (?, ?, ?, ?, ?)`;
            const videoId = videoData.url.split('v=')[1]?.split('&')[0] || 'unknown';

            db.run(sql, [videoId, videoData.title, videoData.url, videoData.description, videoData.transcript], function (err) {
                if (err) {
                    console.error('Error saving video:', err.message);
                    reject(err);
                } else {
                    console.log(`Video saved with ID: ${this.lastID}`);
                    resolve(this.lastID);
                }
            });
        });
    },

    getUnprocessedVideos() {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM videos WHERE processed_by_ollama = 0 AND transcript IS NOT NULL`, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    markProcessed(id) {
        db.run(`UPDATE videos SET processed_by_ollama = 1 WHERE id = ?`, [id]);
    },

    getAllVideos() {
        return new Promise((resolve, reject) => {
            db.all(`SELECT id, video_id, title, url, scraped_at, 
                    SUBSTR(transcript, 1, 200) as transcript_preview,
                    LENGTH(transcript) as transcript_length
                    FROM videos ORDER BY scraped_at DESC`, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
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
            db.get(`SELECT video_id FROM videos WHERE video_id = ?`, [videoId], (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
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
            const placeholders = videoIds.map(() => '?').join(',');
            db.all(`SELECT video_id FROM videos WHERE video_id IN (${placeholders})`, videoIds, (err, rows) => {
                if (err) reject(err);
                else resolve(new Set(rows.map(r => r.video_id)));
            });
        });
    },

    close() {
        db.close();
    }
};

module.exports = Database;