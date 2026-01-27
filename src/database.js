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
            
            db.run(sql, [videoId, videoData.title, videoData.url, videoData.description, videoData.transcript], function(err) {
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
    
    close() {
        db.close();
    }
};

module.exports = Database;