/* Seeds the database from the rickice-*.js content files in public/.
   Run:  npm run seed        (fills in anything missing)
         npm run reset       (wipes products/categories/content first)  */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { sql, ensureReady, pool } = require('./db');

const RESET = process.argv.includes('--reset');
const pub = path.join(__dirname, 'public');

/* The content files are plain browser scripts, so run them against a fake window. */
function loadContent() {
  const win = {};
  const files = ['rickice-chrome.js','rickice-home.js','rickice-boutique.js','rickice-automotive.js',
                 'rickice-fireworks.js','rickice-services.js','rickice-reviews.js','rickice-contact.js',
                 'rickice-about.js','rickice-content.js'];
  for (const f of files) {
    const p = path.join(pub, f);
    if (!fs.existsSync(p)) continue;
    new Function('window', fs.readFileSync(p, 'utf8'))(win);
  }
  return win.RICKICE || {};
}

async function main() {
  await ensureReady();
  const c = loadContent();

  if (RESET) {
    await sql`DELETE FROM products`;
    await sql`DELETE FROM categories`;
    await sql`DELETE FROM content`;
    console.log('Cleared products, categories and content.');
  }

  /* --- staff login ------------------------------------------------------- */
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@rickice.com').toLowerCase();
  const { rows: existing } = await sql`SELECT id FROM users WHERE email = ${adminEmail}`;
  if (!existing[0]) {
    await sql`INSERT INTO users (name, email, password, role) VALUES (
      ${process.env.ADMIN_NAME || 'Rick Ice Admin'}, ${adminEmail},
      ${bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'change-me', 10)}, 'admin')`;
    console.log('Staff login created:', adminEmail);
  }

  /* --- categories & products -------------------------------------------- */
  const depts = { boutique: c.boutique || {}, automotive: c.automotive || {}, fireworks: c.fireworks || {} };
  let nCat = 0, nProd = 0;
  for (const [key, d] of Object.entries(depts)) {
    const cats = d.categories || [];
    for (let i = 0; i < cats.length; i++) {
      const cat = cats[i];
      await sql`INSERT INTO categories (dept, name, photo, sale, sort) VALUES (${key}, ${cat.name}, ${cat.photo || ''}, ${cat.sale ? 1 : 0}, ${i})
        ON CONFLICT (dept, name) DO NOTHING`;
      nCat++;
    }
    for (const p of (d.products || [])) {
      await sql`INSERT INTO products (slot_id, dept, name, price, was, badge, category, colours, blurb, photo, stock)
        VALUES (${p.slotId}, ${key}, ${p.name},
          ${parseFloat(String(p.price || '0').replace(/[^0-9.]/g, '')) || 0},
          ${parseFloat(String(p.was || '0').replace(/[^0-9.]/g, '')) || 0},
          ${p.badge || ''}, ${p.category || ''}, ${JSON.stringify(p.colours || [])}, ${p.blurb || ''}, ${p.photo || ''}, 10)
        ON CONFLICT (slot_id) DO NOTHING`;
      nProd++;
    }
  }

  /* --- page wording ------------------------------------------------------ */
  function trim(d) { const o = Object.assign({}, d); delete o.products; delete o.categories; return o; }
  const sections = {
    chrome:     { topBar: c.topBar, brand: c.brand, account: c.account, footer: c.footer },
    home:       c.home, services: c.services, reviews: c.reviews,
    contact:    c.contact, about: c.about,
    boutique:   trim(depts.boutique), automotive: trim(depts.automotive), fireworks: trim(depts.fireworks)
  };

  for (const [k, v] of Object.entries(sections)) {
    await sql`INSERT INTO content (section, json) VALUES (${k}, ${JSON.stringify(v || {})})
      ON CONFLICT (section) DO UPDATE SET json = EXCLUDED.json`;
  }

  console.log(`Seeded ${nCat} categories, ${nProd} products, ${Object.keys(sections).length} content sections.`);
  console.log('Done. Start the site with:  npm start');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
