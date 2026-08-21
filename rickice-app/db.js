const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_URL;
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || '');
const hasSslMode = /[?&]sslmode=/.test(connectionString || '');

/* Managed providers (Neon, Prisma Postgres, Supabase, ...) already encode
   sslmode= in the connection string, so let pg parse that itself. Only
   force a permissive SSL config for providers that don't specify one. */
const pool = new Pool({
  connectionString,
  ssl: hasSslMode || isLocal ? undefined : { rejectUnauthorized: false }
});

/* Turns a tagged template into a normal parameterised query, e.g.
   sql`SELECT * FROM users WHERE id = ${id}`  ->  query('SELECT * FROM users WHERE id = $1', [id])
   `queryable` is either the pool (autocommits) or a checked-out client (for transactions). */
function makeSqlTag(queryable) {
  return (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1];
    return queryable.query(text, values);
  };
}

const sql = makeSqlTag(pool);

/* Runs fn with a sql tag bound to a single client inside BEGIN/COMMIT, rolling back on error. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(makeSqlTag(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  phone      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'customer',   -- customer | staff | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id     SERIAL PRIMARY KEY,
  dept   TEXT NOT NULL,
  name   TEXT NOT NULL,
  photo  TEXT DEFAULT '',
  sale   INTEGER DEFAULT 0,
  sort   INTEGER DEFAULT 0,
  UNIQUE (dept, name)
);

CREATE TABLE IF NOT EXISTS products (
  id                    SERIAL PRIMARY KEY,
  slot_id               TEXT NOT NULL UNIQUE,
  dept                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  price                 DOUBLE PRECISION NOT NULL DEFAULT 0,
  was                   DOUBLE PRECISION DEFAULT 0,
  badge                 TEXT DEFAULT '',
  category              TEXT DEFAULT '',
  colours               JSONB DEFAULT '[]'::jsonb,
  blurb                 TEXT DEFAULT '',
  photo                 TEXT DEFAULT '',
  stock                 INTEGER NOT NULL DEFAULT 0,
  active                INTEGER NOT NULL DEFAULT 1,
  barcode               TEXT DEFAULT '',
  vendor_barcode_photo  TEXT DEFAULT '',
  sort                  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id         SERIAL PRIMARY KEY,
  ref        TEXT NOT NULL UNIQUE,
  user_id    INTEGER REFERENCES users(id),
  name       TEXT NOT NULL,
  email      TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  mode       TEXT DEFAULT 'Deliver',
  pay        TEXT DEFAULT 'Cash',
  subtotal   DOUBLE PRECISION DEFAULT 0,
  delivery   DOUBLE PRECISION DEFAULT 0,
  total      DOUBLE PRECISION DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'Pending',   -- Pending | Confirmed | Ready | Completed | Cancelled
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name       TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1,
  price      DOUBLE PRECISION NOT NULL DEFAULT 0,
  fitting    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  name       TEXT NOT NULL,
  product    TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  body       TEXT NOT NULL,
  approved   INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  ref        TEXT DEFAULT '',
  service    TEXT NOT NULL,
  item       TEXT DEFAULT '',
  day        TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'Requested', -- Requested | Confirmed | Done | Cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content (
  section TEXT PRIMARY KEY,
  json    JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_log (
  id         SERIAL PRIMARY KEY,
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  sent       INTEGER NOT NULL DEFAULT 0,
  error      TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

/* Runs the schema (and the starting order-ref counter) once per cold start.
   CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING make this safe to repeat.
   ALTER TABLE ADD COLUMN IF NOT EXISTS covers columns added after a table
   already existed in production, since CREATE TABLE IF NOT EXISTS alone
   only affects tables that don't exist yet. */
let ready = null;
function ensureReady() {
  if (!ready) {
    ready = pool.query(SCHEMA)
      .then(() => pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS sort INTEGER NOT NULL DEFAULT 0'))
      .then(() => pool.query("INSERT INTO counters (name, value) VALUES ('order_ref', 1042) ON CONFLICT (name) DO NOTHING"));
  }
  return ready;
}

async function nextRef() {
  const { rows } = await sql`UPDATE counters SET value = value + 1 WHERE name = 'order_ref' RETURNING value`;
  return 'RIS-' + rows[0].value;
}

module.exports = { pool, sql, withTransaction, ensureReady, nextRef };
