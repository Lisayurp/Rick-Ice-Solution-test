/* One-time migration from the old local SQLite database + local uploads
   folder into Postgres + Vercel Blob.

   Run this AFTER `npm run seed` (seed loads the generic starter catalogue;
   this script then overwrites it with your real categories/products/content,
   so it must run second or the generic content wins).

   Needs POSTGRES_URL and BLOB_READ_WRITE_TOKEN in your local .env, pointed
   at the same values as your live Vercel project. Safe to re-run.

       npm run migrate-legacy
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { put } = require('@vercel/blob');
const { sql, ensureReady, pool } = require('./db');

const LOCAL_DB = path.join(__dirname, 'data', 'rickice.db');
const UPLOADS_DIR = path.join(__dirname, 'public', 'images', 'uploads');

const isUploadPath = s => typeof s === 'string' && s.includes('images/uploads/');

async function main() {
  if (!fs.existsSync(LOCAL_DB)) {
    console.log('No local database found at', LOCAL_DB, '- nothing to migrate.');
    return;
  }
  await ensureReady();
  const local = new Database(LOCAL_DB, { readonly: true });
  const blobCache = new Map(); // local filename -> new Blob URL, so we only upload each file once

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
    console.log('  uploaded', filename);
    return blob.url;
  }

  // Walks any JSON value (the "content" blobs) and swaps local upload paths for their new Blob URL.
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

  console.log('\n--- users ---');
  for (const u of local.prepare('SELECT * FROM users').all()) {
    await sql`INSERT INTO users (name, email, phone, address, password, role)
      VALUES (${u.name}, ${u.email}, ${u.phone || ''}, ${u.address || ''}, ${u.password}, ${u.role})
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, address=EXCLUDED.address,
        password=EXCLUDED.password, role=EXCLUDED.role`;
    console.log('  ', u.email, '(' + u.role + ')');
  }

  console.log('\n--- categories ---');
  for (const c of local.prepare('SELECT * FROM categories').all()) {
    const photo = await migratePhoto(c.photo);
    await sql`INSERT INTO categories (dept, name, photo, sale, sort) VALUES (${c.dept}, ${c.name}, ${photo}, ${c.sale}, ${c.sort})
      ON CONFLICT (dept, name) DO UPDATE SET photo=EXCLUDED.photo, sale=EXCLUDED.sale, sort=EXCLUDED.sort`;
    console.log('  ', c.dept, '/', c.name);
  }

  console.log('\n--- products ---');
  for (const p of local.prepare('SELECT * FROM products').all()) {
    const photo = await migratePhoto(p.photo);
    const vendorBarcodePhoto = await migratePhoto(p.vendor_barcode_photo);
    await sql`INSERT INTO products (slot_id, dept, name, price, was, badge, category, colours, blurb, photo, stock, active, barcode, vendor_barcode_photo)
      VALUES (${p.slot_id}, ${p.dept}, ${p.name}, ${p.price}, ${p.was}, ${p.badge || ''}, ${p.category || ''},
        ${p.colours || '[]'}, ${p.blurb || ''}, ${photo}, ${p.stock}, ${p.active}, ${p.barcode || ''}, ${vendorBarcodePhoto})
      ON CONFLICT (slot_id) DO UPDATE SET dept=EXCLUDED.dept, name=EXCLUDED.name, price=EXCLUDED.price, was=EXCLUDED.was,
        badge=EXCLUDED.badge, category=EXCLUDED.category, colours=EXCLUDED.colours, blurb=EXCLUDED.blurb, photo=EXCLUDED.photo,
        stock=EXCLUDED.stock, active=EXCLUDED.active, barcode=EXCLUDED.barcode, vendor_barcode_photo=EXCLUDED.vendor_barcode_photo`;
    console.log('  ', p.slot_id, p.name);
  }

  console.log('\n--- content (page text + banners) ---');
  for (const row of local.prepare('SELECT * FROM content').all()) {
    const json = await migrateDeep(JSON.parse(row.json));
    await sql`INSERT INTO content (section, json) VALUES (${row.section}, ${JSON.stringify(json)})
      ON CONFLICT (section) DO UPDATE SET json = EXCLUDED.json`;
    console.log('  ', row.section);
  }

  // Old SQLite row ids won't match the new Postgres ids, so historical
  // orders/reviews/bookings come across un-linked to a user account.
  console.log('\n--- reviews ---');
  const reviews = local.prepare('SELECT * FROM reviews').all();
  for (const r of reviews) {
    await sql`INSERT INTO reviews (user_id, name, product, rating, body, approved)
      VALUES (NULL, ${r.name}, ${r.product}, ${r.rating}, ${r.body}, ${r.approved})`;
  }
  console.log('  ', reviews.length, 'migrated');

  console.log('\n--- bookings ---');
  const bookings = local.prepare('SELECT * FROM bookings').all();
  for (const b of bookings) {
    await sql`INSERT INTO bookings (user_id, ref, service, item, day, phone, note, status)
      VALUES (NULL, ${b.ref || ''}, ${b.service}, ${b.item || ''}, ${b.day || ''}, ${b.phone || ''}, ${b.note || ''}, ${b.status})`;
  }
  console.log('  ', bookings.length, 'migrated');

  console.log('\n--- orders ---');
  const orders = local.prepare('SELECT * FROM orders').all();
  const items = local.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) {
    const { rows } = await sql`INSERT INTO orders (ref, user_id, name, email, phone, address, mode, pay, subtotal, delivery, total, status, note)
      VALUES (${o.ref}, NULL, ${o.name}, ${o.email || ''}, ${o.phone || ''}, ${o.address || ''}, ${o.mode || 'Deliver'}, ${o.pay || 'Cash'},
        ${o.subtotal}, ${o.delivery}, ${o.total}, ${o.status}, ${o.note || ''})
      ON CONFLICT (ref) DO NOTHING RETURNING id`;
    if (rows[0]) {
      for (const it of items.all(o.id)) {
        await sql`INSERT INTO order_items (order_id, product_id, name, qty, price, fitting)
          VALUES (${rows[0].id}, NULL, ${it.name}, ${it.qty}, ${it.price}, ${it.fitting})`;
      }
    }
  }
  console.log('  ', orders.length, 'migrated');

  local.close();
  await pool.end();
  console.log('\nDone. Your photos are now in Vercel Blob and everything else is in Postgres.');
}

main().catch(err => { console.error(err); process.exit(1); });
