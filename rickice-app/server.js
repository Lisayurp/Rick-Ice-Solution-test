require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, nextRef } = require('./db');
const mail = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const money = n => 'EC$' + Math.round(Number(n) || 0).toLocaleString('en-US');

for (const dir of ['data', 'public/images/uploads']) fs.mkdirSync(path.join(__dirname, dir), { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'rickice-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

/* ---------- helpers ---------- */
const uid = req => req.session.userId || null;
const me = req => uid(req) ? db.prepare('SELECT id, name, email, phone, address, role FROM users WHERE id = ?').get(uid(req)) : null;
function needStaff(req, res, next) {
  const u = me(req);
  if (!u || (u.role !== 'admin' && u.role !== 'staff')) return res.status(403).json({ error: 'Staff only' });
  req.user = u; next();
}
function needUser(req, res, next) {
  const u = me(req);
  if (!u) return res.status(401).json({ error: 'Please sign in' });
  req.user = u; next();
}

/* ---------- catalogue + content ---------- */
function catalogue() {
  const rows = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY dept, id').all();
  const cats = db.prepare('SELECT * FROM categories ORDER BY dept, sort, id').all();
  const content = {};
  for (const r of db.prepare('SELECT * FROM content').all()) content[r.section] = JSON.parse(r.json);

  const byDept = key => Object.assign({}, content[key] || {}, {
    categories: cats.filter(c => c.dept === key).map(c => ({ name: c.name, photo: c.photo, sale: !!c.sale })),
    products: rows.filter(p => p.dept === key).map(p => ({
      slotId: p.slot_id, name: p.name, price: String(p.price || ''), was: p.was ? String(p.was) : '',
      badge: p.badge, category: p.category, colours: JSON.parse(p.colours || '[]'),
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

app.get('/api/catalog', (req, res) => res.json(catalogue()));

/* ---------- auth ---------- */
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, phone, address } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const mailAddr = String(email).trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(mailAddr)) return res.status(409).json({ error: 'That email already has an account' });
  const info = db.prepare('INSERT INTO users (name, email, phone, address, password) VALUES (?,?,?,?,?)')
    .run(String(name).trim(), mailAddr, phone || '', address || '', bcrypt.hashSync(String(password), 10));
  req.session.userId = info.lastInsertRowid;
  mail.send(mailAddr, 'Welcome to Rick Ice Solutions',
    `Hi ${name},\n\nYour account is set up. You can now check out faster, follow your orders and leave reviews.\n\n— Rick Ice Solutions`);
  res.json({ user: me(req) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!row || !bcrypt.compareSync(String(password || ''), row.password)) return res.status(401).json({ error: 'Wrong email or password' });
  req.session.userId = row.id;
  mail.send(row.email, 'New sign-in to your Rick Ice account',
    `Hi ${row.name},\n\nYou just signed in. If this wasn't you, reply to this email and we'll help.\n\n— Rick Ice Solutions`);
  res.json({ user: me(req) });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/auth/me', (req, res) => res.json({ user: me(req) }));

app.put('/api/auth/me', needUser, (req, res) => {
  const { name, phone, address } = req.body || {};
  db.prepare('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), address = COALESCE(?, address) WHERE id = ?')
    .run(name || null, phone ?? null, address ?? null, req.user.id);
  res.json({ user: me(req) });
});

/* ---------- orders ---------- */
app.post('/api/orders', (req, res) => {
  const { name, email, phone, address, mode, pay, items } = req.body || {};
  if (!name || !phone || !address) return res.status(400).json({ error: 'Name, phone and address are required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'The cart is empty' });

  const fittingFee = Number((JSON.parse((db.prepare("SELECT json FROM content WHERE section='services'").get() || {}).json || '{}').fitting || {}).price) || 0;
  const lines = [];
  let subtotal = 0;

  for (const line of items) {
    const p = db.prepare('SELECT * FROM products WHERE slot_id = ? AND active = 1').get(line.id);
    if (!p) return res.status(400).json({ error: 'A product in your cart is no longer available' });
    const qty = Math.max(1, Number(line.qty) || 1);
    if (p.stock < qty) return res.status(409).json({ error: `Only ${p.stock} left of ${p.name}` });
    const unit = p.price + (line.fitting ? fittingFee : 0);
    subtotal += unit * qty;
    lines.push({ p, qty, unit, fitting: !!line.fitting });
  }

  const delivery = 0;
  const ref = nextRef();

  const save = db.transaction(() => {
    const info = db.prepare(`INSERT INTO orders (ref, user_id, name, email, phone, address, mode, pay, subtotal, delivery, total)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(ref, uid(req), name, email || '', phone, address, mode || 'Deliver',
        pay || 'Cash', subtotal, delivery, subtotal + delivery);
    const orderId = info.lastInsertRowid;
    const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, qty, price, fitting) VALUES (?,?,?,?,?,?)');
    const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const l of lines) {
      insItem.run(orderId, l.p.id, l.p.name, l.qty, l.unit, l.fitting ? 1 : 0);
      dec.run(l.qty, l.p.id);
      if (l.fitting) db.prepare('INSERT INTO bookings (user_id, ref, service, item, note) VALUES (?,?,?,?,?)')
        .run(uid(req), ref, 'Workshop fitting', l.p.name, 'Booked with order ' + ref);
    }
    return orderId;
  });
  const orderId = save();

  const summary = lines.map(l => `${l.qty} x ${l.p.name}${l.fitting ? ' (with fitting)' : ''} — ${money(l.unit * l.qty)}`).join('\n');
  const body = `Order ${ref}\n\n${summary}\n\nSubtotal ${money(subtotal)}\nDelivery ${delivery ? money(delivery) : 'Free'}\nTotal ${money(subtotal + delivery)}\n\n${mode === 'Pick up in store' ? 'Collect from the shop.' : 'Delivering to: ' + address}\nPayment: ${pay || 'Cash'}`;

  if (email) mail.send(email, `Order ${ref} received — Rick Ice Solutions`,
    `Hi ${name},\n\nThanks — we have your order and we'll confirm it shortly.\n\n${body}\n\n— Rick Ice Solutions`);
  const modeTag = mode === 'Pick up in store' ? '[PICKUP]' : '[DELIVERY]';
  mail.send(process.env.SHOP_EMAIL, `${modeTag} NEW ORDER ${ref} — ${name}`,
    `${body}\n\nCustomer: ${name}\nPhone: ${phone}\nEmail: ${email || '—'}\n\nConfirm it in the admin panel.`);

  res.json({ order: db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId), ref });
});

app.get('/api/orders/mine', needUser, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json({ orders: orders.map(o => Object.assign(o, { items: items.all(o.id) })) });
});

app.get('/api/bookings/mine', needUser, (req, res) =>
  res.json({ bookings: db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY id DESC').all(req.user.id) }));

/* ---------- workshop bookings ---------- */
app.post('/api/bookings', (req, res) => {
  const { service, item, day, phone, note, name, email } = req.body || {};
  if (!service || !note) return res.status(400).json({ error: 'Tell us the service and what is wrong' });
  const info = db.prepare('INSERT INTO bookings (user_id, service, item, day, phone, note) VALUES (?,?,?,?,?,?)')
    .run(uid(req), service, item || '', day || '', phone || '', note);
  const who = (me(req) || {}).email || email;
  if (who) mail.send(who, 'Workshop request received — Rick Ice Solutions',
    `Thanks${name ? ' ' + name : ''},\n\nWe have your request for: ${service}${item ? ' — ' + item : ''}.\n${day ? 'Preferred day: ' + day + '\n' : ''}\nWe'll confirm a time shortly.\n\n— Rick Ice Solutions`);
  mail.send(process.env.SHOP_EMAIL, 'New workshop request', `${service}${item ? ' — ' + item : ''}\nDay: ${day || 'any'}\nPhone: ${phone || '—'}\n\n${note}`);
  res.json({ booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid) });
});

/* ---------- reviews ---------- */
app.get('/api/reviews', (req, res) =>
  res.json({ reviews: db.prepare('SELECT id, name, product, rating, body, created_at FROM reviews WHERE approved = 1 ORDER BY id DESC').all() }));

app.post('/api/reviews', (req, res) => {
  const { name, product, rating, body } = req.body || {};
  const r = Math.round(Number(rating) || 0);
  if (!name || !body || r < 1 || r > 5) return res.status(400).json({ error: 'Add your name, a rating and a few words' });
  const info = db.prepare('INSERT INTO reviews (user_id, name, product, rating, body) VALUES (?,?,?,?,?)')
    .run(uid(req), String(name).trim(), product || 'General — the store', r, String(body).trim());
  res.json({ review: db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid) });
});

/* ---------- admin ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'public/images/uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.toLowerCase().replace(/[^a-z0-9.]+/g, '-'))
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.post('/api/admin/upload', needStaff, upload.single('photo'), (req, res) =>
  res.json({ path: 'images/uploads/' + req.file.filename }));

app.get('/api/admin/summary', needStaff, (req, res) => res.json({
  orders: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all()
    .map(o => Object.assign(o, { items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id) })),
  bookings: db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 100').all(),
  reviews: db.prepare('SELECT * FROM reviews ORDER BY id DESC LIMIT 100').all(),
  products: db.prepare('SELECT * FROM products ORDER BY dept, id').all(),
  categories: db.prepare('SELECT * FROM categories ORDER BY dept, sort, id').all(),
  users: db.prepare('SELECT id, name, email, phone, role, created_at FROM users ORDER BY id DESC').all(),
  content: Object.fromEntries(db.prepare('SELECT * FROM content').all().map(r => [r.section, JSON.parse(r.json)])),
  counts: {
    pending: db.prepare("SELECT COUNT(*) n FROM orders WHERE status = 'Pending'").get().n,
    lowStock: db.prepare('SELECT COUNT(*) n FROM products WHERE stock <= 2 AND active = 1').get().n
  }
}));

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

app.post('/api/admin/products', needStaff, (req, res) => {
  const p = req.body || {};
  if (!p.slot_id || !p.name) return res.status(400).json({ error: 'Give it an ID and a name' });
  const dept = p.dept || 'boutique';
  const existing = db.prepare('SELECT barcode FROM products WHERE slot_id = ?').get(p.slot_id);
  let barcode = existing && existing.barcode;
  if (!barcode) {
    let salt = 0, candidate;
    do { candidate = makeBarcode(p.slot_id, dept, salt++); }
    while (db.prepare('SELECT 1 FROM products WHERE barcode = ?').get(candidate));
    barcode = candidate;
  }
  const vendorBarcodePhoto = dept === 'fireworks' ? '' : (p.vendor_barcode_photo || '');
  db.prepare(`INSERT INTO products (slot_id, dept, name, price, was, badge, category, colours, blurb, photo, stock, active, barcode, vendor_barcode_photo)
    VALUES (@slot_id,@dept,@name,@price,@was,@badge,@category,@colours,@blurb,@photo,@stock,1,@barcode,@vendor_barcode_photo)
    ON CONFLICT(slot_id) DO UPDATE SET dept=@dept, name=@name, price=@price, was=@was, badge=@badge,
      category=@category, colours=@colours, blurb=@blurb, photo=@photo, stock=@stock, barcode=@barcode, vendor_barcode_photo=@vendor_barcode_photo`).run({
    slot_id: p.slot_id, dept, name: p.name,
    price: Number(p.price) || 0, was: Number(p.was) || 0, badge: p.badge || '',
    category: p.category || '', colours: JSON.stringify(p.colours || []),
    blurb: p.blurb || '', photo: p.photo || '', stock: Number(p.stock) || 0,
    barcode, vendor_barcode_photo: vendorBarcodePhoto
  });
  res.json({ ok: true, barcode });
});

app.delete('/api/admin/products/:slot', needStaff, (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE slot_id = ?').run(req.params.slot);
  res.json({ ok: true });
});

app.post('/api/admin/categories', needStaff, (req, res) => {
  const { dept, name, photo, sale } = req.body || {};
  if (!dept || !name) return res.status(400).json({ error: 'Department and name are required' });
  db.prepare(`INSERT INTO categories (dept, name, photo, sale) VALUES (?,?,?,?)
    ON CONFLICT(dept, name) DO UPDATE SET photo = excluded.photo, sale = excluded.sale`)
    .run(dept, name, photo || '', sale ? 1 : 0);
  res.json({ ok: true });
});

app.put('/api/admin/categories/reorder', needStaff, (req, res) => {
  const { dept, ids } = req.body || {};
  if (!dept || !Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Department and ids are required' });
  const rows = db.prepare('SELECT id FROM categories WHERE dept = ?').all(dept);
  const valid = new Set(rows.map(r => r.id));
  if (ids.length !== rows.length || !ids.every(id => valid.has(id))) {
    return res.status(400).json({ error: 'ids must match this department\'s categories exactly' });
  }
  const setSort = db.prepare('UPDATE categories SET sort = ? WHERE id = ?');
  db.transaction(() => { ids.forEach((id, i) => setSort.run(i, id)); })();
  res.json({ ok: true });
});

app.put('/api/admin/categories/:id', needStaff, (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No such category' });
  const { dept, name, photo, sale } = req.body || {};
  if (!dept || !name) return res.status(400).json({ error: 'Department and name are required' });
  try {
    db.prepare('UPDATE categories SET dept = ?, name = ?, photo = ?, sale = ? WHERE id = ?')
      .run(dept, name, photo || existing.photo, sale ? 1 : 0, req.params.id);
  } catch (e) {
    return res.status(400).json({ error: 'A category with that department and name already exists' });
  }
  res.json({ ok: true });
});

app.delete('/api/admin/categories/:id', needStaff, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/admin/orders/:id', needStaff, async (req, res) => {
  const status = String((req.body || {}).status || '');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'No such order' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);

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
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'No such booking' });
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, b.id);
  const u = b.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(b.user_id) : null;
  if (u && u.email) await mail.send(u.email, `Workshop booking ${status}`,
    `Hi ${u.name},\n\nYour ${b.service}${b.item ? ' (' + b.item + ')' : ''} is now marked: ${status}.\n\n— Rick Ice Solutions`);
  res.json({ ok: true, whatsapp: mail.whatsappLink(b.phone, `Hi, your Rick Ice workshop booking is ${status}`) });
});

app.put('/api/admin/reviews/:id', needStaff, (req, res) => {
  db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run((req.body || {}).approved ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/reviews/:id', needStaff, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/admin/content/:section', needStaff, (req, res) => {
  db.prepare('INSERT OR REPLACE INTO content (section, json) VALUES (?,?)')
    .run(req.params.section, JSON.stringify(req.body || {}));
  res.json({ ok: true });
});

app.post('/api/admin/staff', needStaff, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin can add staff' });
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)')
    .run(name, String(email).toLowerCase(), bcrypt.hashSync(String(password), 10), role === 'admin' ? 'admin' : 'staff');
  res.json({ ok: true });
});

app.put('/api/admin/users/:id', needStaff, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin can edit accounts' });
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  const { name, email, password, role } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  const mailAddr = String(email).toLowerCase();
  const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(mailAddr, id);
  if (clash) return res.status(409).json({ error: 'That email already has an account' });
  const nextRole = ['admin', 'staff', 'customer'].includes(role) ? role : 'customer';
  if (password) {
    db.prepare('UPDATE users SET name=?, email=?, role=?, password=? WHERE id=?')
      .run(name, mailAddr, nextRole, bcrypt.hashSync(String(password), 10), id);
  } else {
    db.prepare('UPDATE users SET name=?, email=?, role=? WHERE id=?').run(name, mailAddr, nextRole, id);
  }
  res.json({ ok: true });
});

/* ---------- the site ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Rick Ice Solutions.dc.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => {
  console.log('\n  Rick Ice Solutions');
  console.log('  Shop   http://localhost:' + PORT);
  console.log('  Admin  http://localhost:' + PORT + '/admin\n');
});
