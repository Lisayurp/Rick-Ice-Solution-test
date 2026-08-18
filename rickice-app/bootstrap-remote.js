/* TEMPORARY — works around this network's port-5432 (Postgres) block.
   Reads the local SQLite db and uploads local photos (both work fine
   locally), then sends everything over normal HTTPS to the two temporary
   /api/_bootstrap/* routes in server.js, which do the actual database
   writes from Vercel's own servers.

   Needs BLOB_READ_WRITE_TOKEN in .env (already there) and the site's URL.

       node bootstrap-remote.js https://your-site.vercel.app
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { put } = require('@vercel/blob');

const SITE_URL = process.argv[2];
if (!SITE_URL) {
  console.error('Usage: node bootstrap-remote.js https://your-site.vercel.app');
  process.exit(1);
}

const LOCAL_DB = path.join(__dirname, 'data', 'rickice.db');
const UPLOADS_DIR = path.join(__dirname, 'public', 'images', 'uploads');
const isUploadPath = s => typeof s === 'string' && s.includes('images/uploads/');

async function call(route, body) {
  const res = await fetch(SITE_URL + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bootstrap-secret': process.env.SESSION_SECRET },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(route + ' failed (' + res.status + '): ' + (json.error || JSON.stringify(json)));
  return json;
}

async function main() {
  console.log('1. Seeding the baseline catalogue (creates admin login + generic content)...');
  const seedResult = await call('/api/_bootstrap/seed');
  console.log('   ', seedResult);

  if (!fs.existsSync(LOCAL_DB)) {
    console.log('\nNo local database found — nothing more to migrate.');
    return;
  }

  console.log('\n2. Uploading local photos to Blob and reading your real data...');
  const local = new Database(LOCAL_DB, { readonly: true });
  const blobCache = new Map();

  async function migratePhoto(value) {
    if (!isUploadPath(value)) return value || '';
    const filename = path.basename(value);
    if (blobCache.has(filename)) return blobCache.get(filename);
    const localPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(localPath)) {
      console.warn('  ! missing local file, leaving old path as-is:', value);
      return value;
    }
    const blob = await put('uploads/' + filename, fs.readFileSync(localPath), { access: 'public', addRandomSuffix: true });
    blobCache.set(filename, blob.url);
    console.log('   uploaded', filename);
    return blob.url;
  }

  async function migrateDeep(node) {
    if (Array.isArray(node)) {
      const out = [];
      for (const item of node) out.push(await migrateDeep(item));
      return out;
    }
    if (node && typeof node === 'object') {
      const out = {};
      for (const k of Object.keys(node)) out[k] = await migrateDeep(node[k]);
      return out;
    }
    return isUploadPath(node) ? migratePhoto(node) : node;
  }

  const users = local.prepare('SELECT * FROM users').all();

  const categories = [];
  for (const c of local.prepare('SELECT * FROM categories').all()) {
    categories.push(Object.assign({}, c, { photo: await migratePhoto(c.photo) }));
  }

  const products = [];
  for (const p of local.prepare('SELECT * FROM products').all()) {
    products.push(Object.assign({}, p, {
      photo: await migratePhoto(p.photo),
      vendor_barcode_photo: await migratePhoto(p.vendor_barcode_photo)
    }));
  }

  const content = [];
  for (const row of local.prepare('SELECT * FROM content').all()) {
    content.push({ section: row.section, json: await migrateDeep(JSON.parse(row.json)) });
  }

  const reviews = local.prepare('SELECT * FROM reviews').all();
  const bookings = local.prepare('SELECT * FROM bookings').all();
  const orders = local.prepare('SELECT * FROM orders').all();
  const itemsStmt = local.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) o.items = itemsStmt.all(o.id);

  local.close();

  console.log('\n3. Sending your real data to the live database...');
  const migrateResult = await call('/api/_bootstrap/migrate', { users, categories, products, content, reviews, bookings, orders });
  console.log('   ', migrateResult);

  console.log('\nDone! Your live site now has your real categories, products, content and photos.');
}

main().catch(err => { console.error(err); process.exit(1); });
