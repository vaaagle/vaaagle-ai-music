const path = require("path");
const { app } = require("electron");
const sqlite3 = require("sqlite3").verbose();

let db;

function initDb() {
  if (db) {
    return db;
  }
  const dbPath = path.join(app.getPath("userData"), "favorites.db");
  db = new sqlite3.Database(dbPath);
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        pic_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(track_id, source)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        pic_id TEXT,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(track_id, source)
      )
    `);
  });
  return db;
}

function run(sql, params = []) {
  const conn = initDb();
  return new Promise((resolve, reject) => {
    conn.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  const conn = initDb();
  return new Promise((resolve, reject) => {
    conn.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  const conn = initDb();
  return new Promise((resolve, reject) => {
    conn.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

async function addFavorite(track) {
  await run(
    `
    INSERT OR IGNORE INTO favorites (track_id, source, name, artist, album, pic_id)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [track.id, track.source, track.name, track.artist || "", track.album || "", track.pic_id || ""]
  );
  return true;
}

async function removeFavorite(trackId, source) {
  await run("DELETE FROM favorites WHERE track_id = ? AND source = ?", [trackId, source]);
  return true;
}

function listFavorites() {
  return all(
    `
    SELECT track_id as id, source, name, artist, album, pic_id
    FROM favorites
    ORDER BY created_at DESC
    `
  );
}

async function isFavorite(trackId, source) {
  const row = await get("SELECT 1 as existsFlag FROM favorites WHERE track_id = ? AND source = ?", [trackId, source]);
  return Boolean(row && row.existsFlag);
}

async function addPlayHistory(track) {
  await run(
    `
    INSERT INTO play_history (track_id, source, name, artist, album, pic_id, played_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(track_id, source) DO UPDATE SET
      name = excluded.name,
      artist = excluded.artist,
      album = excluded.album,
      pic_id = excluded.pic_id,
      played_at = CURRENT_TIMESTAMP
    `,
    [track.id, track.source, track.name, track.artist || "", track.album || "", track.pic_id || ""]
  );
  return true;
}

function listPlayHistory(limit = 50) {
  return all(
    `
    SELECT track_id as id, source, name, artist, album, pic_id, played_at
    FROM play_history
    ORDER BY played_at DESC
    LIMIT ?
    `,
    [limit]
  );
}

async function clearPlayHistory() {
  await run("DELETE FROM play_history");
  return true;
}

module.exports = {
  initDb,
  addFavorite,
  removeFavorite,
  listFavorites,
  isFavorite,
  addPlayHistory,
  listPlayHistory,
  clearPlayHistory
};
