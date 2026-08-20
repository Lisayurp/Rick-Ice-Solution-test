require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { put } = require('@vercel/blob');
const { sql, pool, withTransaction, ensureReady, nextRef } = require('./db');
const mail = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const money = n => 'EC$' + Math.round(Number(n) || 0).toLocaleString('en-US');

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

/* Runs the schema once per cold start before any route touches the database. */
app.use(async (req, res, next) => {
  try { await ensureReady(); next(); } catch (err) { next(err); }
});

app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'rickice-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!process.env.VERCEL,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

/* ---------- helpers ---------- */
const uid = req => req.session.userId || null;
async function me(req) {
  const id = uid(req);
  if (!id) return null;
  const { rows } = await sql`SELECT id, name, email, phone, address, role FROM users WHERE id = ${id}`;
  return rows[0] || null;
}
async function needStaff(req, res, next) {
  const u = await me(req);
  if (!u || (u.role !== 'admin' && u.role !== 'staff')) return res.status(403).json({ error: 'Staff only' });
  req.user = u; next();
}
async function needUser(req, res, next) {
  const u = await me(req);
  if (!u) return res.status(401).json({ error: 'Please sign in' });
  req.user = u; next();
}

/* ---------- catalogue + content ---------- */
async function catalogue() {
  const { rows } = await sql`SELECT * FROM products WHERE active = 1 ORDER BY dept, id`;
  const { rows: cats } = await sql`SELECT * FROM categories ORDER BY dept, sort, id`;
  const { rows: contentRows } = await sql`SELECT * FROM content`;
  const content = {};
  for (const r of contentRows) content[r.section] = r.json; // JSONB comes back already parsed

  const byDept = key => Object.assign({}, content[key] || {}, {
    categories: cats.filter(c => c.dept === key).map(c => ({ name: c.name, photo: c.photo, sale: !!c.sale })),
    products: rows.filter(p => p.dept === key).map(p => ({
      slotId: p.slot_id, name: p.name, price: String(p.price ?? ''), was: p.was ? String(p.was) : '',
      badge: p.badge, category: p.category, colours: p.colours || [],
      blurb: p.blurb, photo: p.photo, stock: p.stock
    }))
  });

  const chrome = content.chrome || {};
  return {
    topBar: chrome.topBar || {}, brand: chrome.brand || {}, account: chrome.account || {}, footer: chrome.footer || {},
    home: content.home || {}, services: content.services || {}, reviews: content.reviews || {},
    showcase: content.reviews || {}, contact: content.contact || {}, about: content.about || {},
    fitting: (content.services || {}).fitting || {},
    boutique: byDept('boutique'), automotive: byDept('automotive'), fireworks: byDept('fireworks')
  };
}

app.get('/api/catalog', async (req, res) => res.json(await catalogue()));

/* ---------- auth ---------- */
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, phone, address } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const mailAddr = String(email).trim().toLowerCase();
  const { rows: existing } = await sql`SELECT id FROM users WHERE email = ${mailAddr}`;
  if (existing[0]) return res.status(409).json({ error: 'That email already has an account' });
  const { rows } = await sql`INSERT INTO users (name, email, phone, address, password)
    VALUES (${String(name).trim()}, ${mailAddr}, ${phone || ''}, ${address || ''}, ${bcrypt.hashSync(String(password), 10)}) RETURNING id`;
  req.session.userId = rows[0].id;
  mail.send(mailAddr, 'Welcome to Rick Ice Solutions',
    `Hi ${name},\n\nYour account is set up. You can now check out faster, follow your orders and leave reviews.\n\n— Rick Ice Solutions`);
  res.json({ user: await me(req) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await sql`SELECT * FROM users WHERE email = ${String(email || '').trim().toLowerCase()}`;
  const row = rows[0];
  if (!row || !bcrypt.compareSync(String(password || ''), row.password)) return res.status(401).json({ error: 'Wrong email or password' });
  req.session.userId = row.id;
  mail.send(row.email, 'New sign-in to your Rick Ice account',
    `Hi ${row.name},\n\nYou just signed in. If this wasn't you, reply to this email and we'll help.\n\n— Rick Ice Solutions`);
  res.json({ user: await me(req) });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/auth/me', async (req, res) => res.json({ user: await me(req) }));

app.put('/api/auth/me', needUser, async (req, res) => {
  const { name, phone, address } = req.body || {};
  await sql`UPDATE users SET name = COALESCE(${name || null}, name), phone = COALESCE(${phone ?? null}, phone), address = COALESCE(${address ?? null}, address) WHERE id = ${req.user.id}`;
  res.json({ user: await me(req) });
});

/* ---------- contact ---------- */
app.post('/api/contact', async (req, res) => {
  const { name, contact, topic, message } = req.body || {};
  if (!String(name || '').trim() || !String(contact || '').trim() || !String(message || '').trim()) {
    return res.status(400).json({ error: 'Add your name, a way to reach you, and a message' });
  }
  const { rows } = await sql`SELECT json FROM content WHERE section = 'contact'`;
  const shopEmail = (rows[0] && rows[0].json && rows[0].json.email) || process.env.MAIL_FROM || '';
  const contactTrimmed = String(contact).trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactTrimmed);

  await mail.send(shopEmail, `New message from ${name} (${topic || 'general'})`,
    `From: ${name}\nReach them at: ${contact}\nTopic: ${topic || '—'}\n\n${message}`,
    { replyTo: isEmail ? contactTrimmed : undefined });

  if (isEmail) {
    await mail.send(contactTrimmed, 'We got your message — Rick Ice Solutions',
      `Hi ${name},\n\nThanks for reaching out — we got your message and will reply within one business day.\n\nWhat you sent us:\n${message}\n\n— Rick Ice Solutions`);
  }

  res.json({ ok: true, confirmedByEmail: isEmail });
});

/* ---------- orders ---------- */
app.post('/api/orders', async (req, res) => {
  const { name, email, phone, address, mode, pay, items } = req.body || {};
  if (!name || !phone || !address) return res.status(400).json({ error: 'Name, phone and address are required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'The cart is empty' });

  const { rows: svcRows } = await sql`SELECT json FROM content WHERE section = 'services'`;
  const fittingFee = Number(((svcRows[0] || {}).json || {}).fitting?.price) || 0;
  const lines = [];
  let subtotal = 0;

  for (const line of items) {
    const { rows } = await sql`SELECT * FROM products WHERE slot_id = ${line.id} AND active = 1`;
    const p = rows[0];
    if (!p) return res.status(400).json({ error: 'A product in your cart is no longer available' });
    const qty = Math.max(1, Number(line.qty) || 1);
    if (p.stock < qty) return res.status(409).json({ error: `Only ${p.stock} left of ${p.name}` });
    const unit = p.price + (line.fitting ? fittingFee : 0);
    subtotal += unit * qty;
    lines.push({ p, qty, unit, fitting: !!line.fitting });
  }

  const delivery = 0;
  const ref = await nextRef();
  const userId = uid(req);

  const orderId = await withTransaction(async (tsql) => {
    const { rows } = await tsql`INSERT INTO orders (ref, user_id, name, email, phone, address, mode, pay, subtotal, delivery, total)
      VALUES (${ref}, ${userId}, ${name}, ${email || ''}, ${phone}, ${address}, ${mode || 'Deliver'}, ${pay || 'Cash'}, ${subtotal}, ${delivery}, ${subtotal + delivery})
      RETURNING id`;
    const orderId = rows[0].id;
    for (const l of lines) {
      await tsql`INSERT INTO order_items (order_id, product_id, name, qty, price, fitting) VALUES (${orderId}, ${l.p.id}, ${l.p.name}, ${l.qty}, ${l.unit}, ${l.fitting ? 1 : 0})`;
      await tsql`UPDATE products SET stock = stock - ${l.qty} WHERE id = ${l.p.id}`;
      if (l.fitting) await tsql`INSERT INTO bookings (user_id, ref, service, item, note) VALUES (${userId}, ${ref}, 'Workshop fitting', ${l.p.name}, ${'Booked with order ' + ref})`;
    }
    return orderId;
  });

  const summary = lines.map(l => `${l.qty} x ${l.p.name}${l.fitting ? ' (with fitting)' : ''} — ${money(l.unit * l.qty)}`).join('\n');
  const body = `Order ${ref}\n\n${summary}\n\nSubtotal ${money(subtotal)}\nDelivery ${delivery ? money(delivery) : 'Free'}\nTotal ${money(subtotal + delivery)}\n\n${mode === 'Pick up in store' ? 'Collect from the shop.' : 'Delivering to: ' + address}\nPayment: ${pay || 'Cash'}`;

  if (email) mail.send(email, `Order ${ref} received — Rick Ice Solutions`,
    `Hi ${name},\n\nThanks — we have your order and we'll confirm it shortly.\n\n${body}\n\n— Rick Ice Solutions`);
  const modeTag = mode === 'Pick up in store' ? '[PICKUP]' : '[DELIVERY]';
  mail.send(process.env.SHOP_EMAIL, `${modeTag} NEW ORDER ${ref} — ${name}`,
    `${body}\n\nCustomer: ${name}\nPhone: ${phone}\nEmail: ${email || '—'}\n\nConfirm it in the admin panel.`);

  const { rows: orderRows } = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
  res.json({ order: orderRows[0], ref });
});

/* Public order lookup by ref, for the "track my order" page -- anyone with
   the ref can check status, so this deliberately returns only what's
   needed to show a status timeline, never the customer's name/phone/email/
   address, since ref numbers are guessable. */
app.get('/api/orders/track/:ref', async (req, res) => {
  const ref = String(req.params.ref || '').trim().toUpperCase();
  if (!ref) return res.status(400).json({ error: 'Enter an order number' });
  const { rows } = await sql`SELECT ref, status, mode, pay, total, created_at FROM orders WHERE ref = ${ref}`;
  const order = rows[0];
  if (!order) return res.status(404).json({ error: "We couldn't find that number" });
  res.json({ order });
});

app.get('/api/orders/mine', needUser, async (req, res) => {
  const { rows: orders } = await sql`SELECT * FROM orders WHERE user_id = ${req.user.id} ORDER BY id DESC`;
  for (const o of orders) {
    const { rows: items } = await sql`SELECT * FROM order_items WHERE order_id = ${o.id}`;
    o.items = items;
  }
  res.json({ orders });
});

app.get('/api/bookings/mine', needUser, async (req, res) => {
  const { rows: bookings } = await sql`SELECT * FROM bookings WHERE user_id = ${req.user.id} ORDER BY id DESC`;
  res.json({ bookings });
});

/* ---------- workshop bookings ---------- */
app.post('/api/bookings', async (req, res) => {
  const { service, item, day, phone, note, name, email } = req.body || {};
  if (!service || !note) return res.status(400).json({ error: 'Tell us the service and what is wrong' });
  const { rows } = await sql`INSERT INTO bookings (user_id, service, item, day, phone, note)
    VALUES (${uid(req)}, ${service}, ${item || ''}, ${day || ''}, ${phone || ''}, ${note}) RETURNING id`;
  const currentUser = await me(req);
  const who = (currentUser || {}).email || email;
  if (who) mail.send(who, 'Workshop request received — Rick Ice Solutions',
    `Thanks${name ? ' ' + name : ''},\n\nWe have your request for: ${service}${item ? ' — ' + item : ''}.\n${day ? 'Preferred day: ' + day + '\n' : ''}\nWe'll confirm a time shortly.\n\n— Rick Ice Solutions`);
  mail.send(process.env.SHOP_EMAIL, 'New workshop request', `${service}${item ? ' — ' + item : ''}\nDay: ${day || 'any'}\nPhone: ${phone || '—'}\n\n${note}`);
  const { rows: bRows } = await sql`SELECT * FROM bookings WHERE id = ${rows[0].id}`;
  res.json({ booking: bRows[0] });
});

/* ---------- reviews ---------- */
app.get('/api/reviews', async (req, res) => {
  const { rows } = await sql`SELECT id, name, product, rating, body, created_at FROM reviews WHERE approved = 1 ORDER BY id DESC`;
  res.json({ reviews: rows });
});

app.post('/api/reviews', async (req, res) => {
  const { name, product, rating, body } = req.body || {};
  const r = Math.round(Number(rating) || 0);
  if (!name || !body || r < 1 || r > 5) return res.status(400).json({ error: 'Add your name, a rating and a few words' });
  const { rows } = await sql`INSERT INTO reviews (user_id, name, product, rating, body)
    VALUES (${uid(req)}, ${String(name).trim()}, ${product || 'General — the store'}, ${r}, ${String(body).trim()}) RETURNING id`;
  const { rows: rRows } = await sql`SELECT * FROM reviews WHERE id = ${rows[0].id}`;
  res.json({ review: rRows[0] });
});

/* ---------- admin ---------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.post('/api/admin/upload', needStaff, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filename = Date.now() + '-' + req.file.originalname.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  const blob = await put('uploads/' + filename, req.file.buffer, {
    access: 'public', contentType: req.file.mimetype, addRandomSuffix: true
  });
  res.json({ path: blob.url });
});

app.get('/api/admin/summary', needStaff, async (req, res) => {
  const { rows: orders } = await sql`SELECT * FROM orders ORDER BY id DESC LIMIT 100`;
  for (const o of orders) {
    const { rows: items } = await sql`SELECT * FROM order_items WHERE order_id = ${o.id}`;
    o.items = items;
  }
  const { rows: bookings } = await sql`SELECT * FROM bookings ORDER BY id DESC LIMIT 100`;
  const { rows: reviews } = await sql`SELECT * FROM reviews ORDER BY id DESC LIMIT 100`;
  const { rows: products } = await sql`SELECT * FROM products ORDER BY dept, id`;
  const { rows: categories } = await sql`SELECT * FROM categories ORDER BY dept, sort, id`;
  const { rows: users } = await sql`SELECT id, name, email, phone, role, created_at FROM users ORDER BY id DESC`;
  const { rows: contentRows } = await sql`SELECT * FROM content`;
  const content = Object.fromEntries(contentRows.map(r => [r.section, r.json]));
  const { rows: pendingRows } = await sql`SELECT COUNT(*) n FROM orders WHERE status = 'Pending'`;
  const { rows: lowStockRows } = await sql`SELECT COUNT(*) n FROM products WHERE stock <= 2 AND active = 1`;

  res.json({
    orders, bookings, reviews, products, categories, users, content,
    counts: { pending: Number(pendingRows[0].n), lowStock: Number(lowStockRows[0].n) }
  });
});

/* UPC-A barcodes, prefixed '2' (the range GS1 reserves for internal/in-store
   use) since we're not a registered GS1 manufacturer — these scan fine on a
   normal scanner but aren't globally-registered codes. Generated once per
   product and kept stable across edits so printed labels don't go stale. */
function upcCheckDigit(digits11) {
  let odd = 0, even = 0;
  for (let i = 0; i < 11; i++) (i % 2 === 0 ? odd += Number(digits11[i]) : even += Number(digits11[i]));
  return String((10 - ((odd * 3 + even) % 10)) % 10);
}
function hashDigits(str, len) {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < str.length; i++) {
    h1 = (h1 * 31 + str.charCodeAt(i)) >>> 0;
    h2 = (h2 * 131 + str.charCodeAt(i)) >>> 0;
  }
  return (String(h1) + String(h2) + '0000000000').slice(0, len);
}
function makeBarcode(slotId, dept, salt) {
  const digits11 = '2' + hashDigits(dept + '|' + slotId + '|' + salt, 10);
  return digits11 + upcCheckDigit(digits11);
}

app.post('/api/admin/products', needStaff, async (req, res) => {
  const p = req.body || {};
  if (!p.slot_id || !p.name) return res.status(400).json({ error: 'Give it an ID and a name' });
  const dept = p.dept || 'boutique';
  const { rows: existingRows } = await sql`SELECT barcode FROM products WHERE slot_id = ${p.slot_id}`;
  let barcode = existingRows[0] && existingRows[0].barcode;
  if (!barcode) {
    let salt = 0, candidate, clash;
    do {
      candidate = makeBarcode(p.slot_id, dept, salt++);
      const { rows } = await sql`SELECT 1 FROM products WHERE barcode = ${candidate}`;
      clash = rows[0];
    } while (clash);
    barcode = candidate;
  }
  const vendorBarcodePhoto = dept === 'fireworks' ? '' : (p.vendor_barcode_photo || '');

  await sql`INSERT INTO products (slot_id, dept, name, price, was, badge, category, colours, blurb, photo, stock, active, barcode, vendor_barcode_photo)
    VALUES (${p.slot_id}, ${dept}, ${p.name}, ${Number(p.price) || 0}, ${Number(p.was) || 0}, ${p.badge || ''}, ${p.category || ''},
      ${JSON.stringify(p.colours || [])}, ${p.blurb || ''}, ${p.photo || ''}, ${Number(p.stock) || 0}, 1, ${barcode}, ${vendorBarcodePhoto})
    ON CONFLICT (slot_id) DO UPDATE SET dept=EXCLUDED.dept, name=EXCLUDED.name, price=EXCLUDED.price, was=EXCLUDED.was, badge=EXCLUDED.badge,
      category=EXCLUDED.category, colours=EXCLUDED.colours, blurb=EXCLUDED.blurb, photo=EXCLUDED.photo, stock=EXCLUDED.stock,
      barcode=EXCLUDED.barcode, vendor_barcode_photo=EXCLUDED.vendor_barcode_photo`;
  res.json({ ok: true, barcode });
});

app.delete('/api/admin/products/:slot', needStaff, async (req, res) => {
  await sql`UPDATE products SET active = 0 WHERE slot_id = ${req.params.slot}`;
  res.json({ ok: true });
});

app.post('/api/admin/categories', needStaff, async (req, res) => {
  const { dept, name, photo, sale } = req.body || {};
  if (!dept || !name) return res.status(400).json({ error: 'Department and name are required' });
  await sql`INSERT INTO categories (dept, name, photo, sale) VALUES (${dept}, ${name}, ${photo || ''}, ${sale ? 1 : 0})
    ON CONFLICT (dept, name) DO UPDATE SET photo = EXCLUDED.photo, sale = EXCLUDED.sale`;
  res.json({ ok: true });
});

app.put('/api/admin/categories/reorder', needStaff, async (req, res) => {
  const { dept, ids } = req.body || {};
  if (!dept || !Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Department and ids are required' });
  const { rows } = await sql`SELECT id FROM categories WHERE dept = ${dept}`;
  const valid = new Set(rows.map(r => r.id));
  if (ids.length !== rows.length || !ids.every(id => valid.has(id))) {
    return res.status(400).json({ error: 'ids must match this department\'s categories exactly' });
  }
  await withTransaction(async (tsql) => {
    for (let i = 0; i < ids.length; i++) await tsql`UPDATE categories SET sort = ${i} WHERE id = ${ids[i]}`;
  });
  res.json({ ok: true });
});

app.put('/api/admin/categories/:id', needStaff, async (req, res) => {
  const { rows: existingRows } = await sql`SELECT * FROM categories WHERE id = ${req.params.id}`;
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'No such category' });
  const { dept, name, photo, sale } = req.body || {};
  if (!dept || !name) return res.status(400).json({ error: 'Department and name are required' });
  try {
    await sql`UPDATE categories SET dept = ${dept}, name = ${name}, photo = ${photo || existing.photo}, sale = ${sale ? 1 : 0} WHERE id = ${req.params.id}`;
  } catch (e) {
    return res.status(400).json({ error: 'A category with that department and name already exists' });
  }
  res.json({ ok: true });
});

app.delete('/api/admin/categories/:id', needStaff, async (req, res) => {
  await sql`DELETE FROM categories WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

app.put('/api/admin/orders/:id', needStaff, async (req, res) => {
  const status = String((req.body || {}).status || '');
  const { rows } = await sql`SELECT * FROM orders WHERE id = ${req.params.id}`;
  const order = rows[0];
  if (!order) return res.status(404).json({ error: 'No such order' });
  await sql`UPDATE orders SET status = ${status} WHERE id = ${order.id}`;

  const wording = {
    Confirmed: 'is confirmed. We are getting it ready now.',
    Ready: order.mode === 'Pick up in store' ? 'is ready to collect from the shop.' : 'is on its way to you.',
    Completed: 'is complete. Thank you for shopping with us.',
    Cancelled: 'has been cancelled. Get in touch if that looks wrong.'
  }[status];

  if (order.email && wording) {
    await mail.send(order.email, `Order ${order.ref} — ${status}`,
      `Hi ${order.name},\n\nYour order ${order.ref} ${wording}\n\nTotal ${money(order.total)}\n\n— Rick Ice Solutions`);
  }
  res.json({ ok: true, whatsapp: mail.whatsappLink(order.phone, `Hi ${order.name}, your Rick Ice order ${order.ref} ${wording || 'has been updated'}`) });
});

app.put('/api/admin/bookings/:id', needStaff, async (req, res) => {
  const status = String((req.body || {}).status || '');
  const { rows } = await sql`SELECT * FROM bookings WHERE id = ${req.params.id}`;
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'No such booking' });
  await sql`UPDATE bookings SET status = ${status} WHERE id = ${b.id}`;
  const u = b.user_id ? (await sql`SELECT * FROM users WHERE id = ${b.user_id}`).rows[0] : null;
  if (u && u.email) await mail.send(u.email, `Workshop booking ${status}`,
    `Hi ${u.name},\n\nYour ${b.service}${b.item ? ' (' + b.item + ')' : ''} is now marked: ${status}.\n\n— Rick Ice Solutions`);
  res.json({ ok: true, whatsapp: mail.whatsappLink(b.phone, `Hi, your Rick Ice workshop booking is ${status}`) });
});

app.put('/api/admin/reviews/:id', needStaff, async (req, res) => {
  await sql`UPDATE reviews SET approved = ${(req.body || {}).approved ? 1 : 0} WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});
app.delete('/api/admin/reviews/:id', needStaff, async (req, res) => {
  await sql`DELETE FROM reviews WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

app.put('/api/admin/content/:section', needStaff, async (req, res) => {
  await sql`INSERT INTO content (section, json) VALUES (${req.params.section}, ${JSON.stringify(req.body || {})})
    ON CONFLICT (section) DO UPDATE SET json = EXCLUDED.json`;
  res.json({ ok: true });
});

app.post('/api/admin/staff', needStaff, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin can add staff' });
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  await sql`INSERT INTO users (name, email, password, role)
    VALUES (${name}, ${String(email).toLowerCase()}, ${bcrypt.hashSync(String(password), 10)}, ${role === 'admin' ? 'admin' : 'staff'})`;
  res.json({ ok: true });
});

app.put('/api/admin/users/:id', needStaff, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin can edit accounts' });
  const id = Number(req.params.id);
  const { rows: targetRows } = await sql`SELECT id FROM users WHERE id = ${id}`;
  if (!targetRows[0]) return res.status(404).json({ error: 'Not found' });
  const { name, email, password, role } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  const mailAddr = String(email).toLowerCase();
  const { rows: clashRows } = await sql`SELECT id FROM users WHERE email = ${mailAddr} AND id != ${id}`;
  if (clashRows[0]) return res.status(409).json({ error: 'That email already has an account' });
  const nextRole = ['admin', 'staff', 'customer'].includes(role) ? role : 'customer';
  if (password) {
    await sql`UPDATE users SET name=${name}, email=${mailAddr}, role=${nextRole}, password=${bcrypt.hashSync(String(password), 10)} WHERE id=${id}`;
  } else {
    await sql`UPDATE users SET name=${name}, email=${mailAddr}, role=${nextRole} WHERE id=${id}`;
  }
  res.json({ ok: true });
});

/* ---------- the site ----------
   In production these are never reached — vercel.json serves the static
   files and rewrites "/" and "/admin" directly. They're kept here so
   `npm start` / `npm run dev` still serve the whole site locally. */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Rick Ice Solutions.dc.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('\n  Rick Ice Solutions');
    console.log('  Shop   http://localhost:' + PORT);
    console.log('  Admin  http://localhost:' + PORT + '/admin\n');
  });
}

module.exports = app;
