// server/db.js
// Uses Node's built-in `node:sqlite` (stable enough for this scope, no npm install needed).
// One file, one source of truth for prices, buyers, farmers, listings, and ZECC bookings.

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'bao.db');
const isFresh = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS crops (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY,
    crop_id INTEGER NOT NULL,
    zone TEXT NOT NULL,
    market_price REAL NOT NULL,   -- reference city/reference market price (₦/kg)
    farmer_price REAL NOT NULL,   -- what farmers in this zone are typically offered (₦/kg)
    updated_at TEXT NOT NULL,
    FOREIGN KEY (crop_id) REFERENCES crops(id)
  );

  CREATE TABLE IF NOT EXISTS buyers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    crop_id INTEGER NOT NULL,
    zone TEXT NOT NULL,
    phone TEXT,
    FOREIGN KEY (crop_id) REFERENCES crops(id)
  );

  CREATE TABLE IF NOT EXISTS farmers (
    id INTEGER PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    zone TEXT,
    plan TEXT DEFAULT 'none',       -- none | basic
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS harvest_listings (
    id INTEGER PRIMARY KEY,
    farmer_phone TEXT NOT NULL,
    crop_id INTEGER NOT NULL,
    kg REAL NOT NULL,
    status TEXT DEFAULT 'open',     -- open | matched | closed
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS zecc_chambers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    zone TEXT NOT NULL,
    capacity_kg REAL NOT NULL,
    booked_kg REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS zecc_bookings (
    id INTEGER PRIMARY KEY,
    chamber_id INTEGER NOT NULL,
    farmer_phone TEXT NOT NULL,
    farmer_name TEXT,
    kg REAL NOT NULL,
    start_date TEXT NOT NULL,
    days INTEGER NOT NULL,
    status TEXT DEFAULT 'confirmed', -- confirmed | cancelled
    created_at TEXT NOT NULL,
    FOREIGN KEY (chamber_id) REFERENCES zecc_chambers(id)
  );

  CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY,
    channel TEXT NOT NULL,          -- ussd | whatsapp
    phone TEXT,
    direction TEXT NOT NULL,        -- in | out
    text TEXT,
    created_at TEXT NOT NULL
  );
`);

function seed() {
  const now = new Date().toISOString();

  const insertCrop = db.prepare('INSERT INTO crops (name) VALUES (?)');
  const crops = ['Bell Pepper', 'Tomato', 'Cassava'];
  const cropIds = {};
  for (const name of crops) {
    const info = insertCrop.run(name);
    cropIds[name] = Number(info.lastInsertRowid);
  }

  const insertPrice = db.prepare(`
    INSERT INTO prices (crop_id, zone, market_price, farmer_price, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertPrice.run(cropIds['Bell Pepper'], 'Ibadan-Zone A', 850, 410, now);
  insertPrice.run(cropIds['Tomato'], 'Ibadan-Zone A', 620, 305, now);
  insertPrice.run(cropIds['Cassava'], 'Ibadan-Zone A', 180, 140, now);

  const insertBuyer = db.prepare(`
    INSERT INTO buyers (name, crop_id, zone, phone) VALUES (?, ?, ?, ?)
  `);
  insertBuyer.run('Adeyemi Foods', cropIds['Bell Pepper'], 'Ibadan-Zone A', '+2348030000001');
  insertBuyer.run('GreenBasket Co', cropIds['Tomato'], 'Ibadan-Zone A', '+2348030000002');
  insertBuyer.run('Ola Traders', cropIds['Bell Pepper'], 'Ibadan-Zone A', '+2348030000003');
  insertBuyer.run('Sunrise Agro', cropIds['Cassava'], 'Ibadan-Zone A', '+2348030000004');

  const insertChamber = db.prepare(`
    INSERT INTO zecc_chambers (name, zone, capacity_kg) VALUES (?, ?, ?)
  `);
  insertChamber.run('ZECC Unit — Ibadan Zone A', 'Ibadan-Zone A', 500);
  insertChamber.run('ZECC Unit — Ibadan Zone B', 'Ibadan-Zone B', 300);
}

if (isFresh) {
  seed();
}

module.exports = { db };
