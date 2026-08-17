const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data', 'rickice.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  phone      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'customer',   -- customer | staff | admin
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dept   TEXT NOT NULL,
  name   TEXT NOT NULL,
  photo  TEXT DEFAULT '',
  sale   INTEGER DEFAULT 0,
  sort   INTEGER DEFAULT 0,
  UNIQUE (dept, name)
);

CREATE TABLE IF NOT EXISTS products (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id  TEXT NOT NULL UNIQUE,
  dept     TEXT NOT NULL,
  name     TEXT NOT NULL,
  price    REAL NOT NULL DEFAULT 0,
  was      REAL DEFAULT 0,
  badge    TEXT DEFAULT '',
  category TEXT DEFAULT '',
  colours  TEXT DEFAULT '[]',
  blurb    TEXT DEFAULT '',
  photo    TEXT DEFAULT '',
  stock    INTEGER NOT NULL DEFAULT 0,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ref        TEXT NOT NULL UNIQUE,
  user_id    INTEGER REFERENCES users(id),
  name       TEXT NOT NULL,
  email      TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  mode       TEXT DEFAULT 'Deliver',
  pay        TEXT DEFAULT 'Cash',
  subtotal   REAL DEFAULT 0,
  delivery   REAL DEFAULT 0,
  total      REAL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'Pending',   -- Pending | Confirmed | Ready | Completed | Cancelled
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name       TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1,
  price      REAL NOT NULL DEFAULT 0,
  fitting    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  name       TEXT NOT NULL,
  product    TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  body       TEXT NOT NULL,
  approved   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  ref        TEXT DEFAULT '',
  service    TEXT NOT NULL,
  item       TEXT DEFAULT '',
  day        TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'Requested', -- Requested | Confirmed | Done | Cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content (
  section TEXT PRIMARY KEY,
  json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  sent       INTEGER NOT NULL DEFAULT 0,
  error      TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`);

/* Added after the table already existed in the wild, so bring old databases up to date. */
for (const [col, def] of [['barcode', "TEXT DEFAULT ''"], ['vendor_barcode_photo', "TEXT DEFAULT ''"]]) {
  const has = db.prepare('PRAGMA table_info(products)').all().some(c => c.name === col);
  if (!has) db.exec(`ALTER TABLE products ADD COLUMN ${col} ${def}`);
}

db.prepare("INSERT OR IGNORE INTO counters (name, value) VALUES ('order_ref', 1042)").run();

function nextRef() {
  const row = db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'order_ref' RETURNING value").get();
  return 'RIS-' + row.value;
}

module.exports = { db, nextRef };
