# Rick Ice Solutions — the real website

Shop + database + admin panel. Node and SQLite, no other services needed.

---

## 1. Install

You need Node 18 or newer (https://nodejs.org — take the LTS download).

```bash
cd server
npm install
cp .env.example .env        # Windows:  copy .env.example .env
```

Open `.env` and set at least `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `SESSION_SECRET`.

## 2. Fill the database

```bash
npm run seed
```

This reads the `rickice-*.js` files in `public/` and loads the products,
categories and page wording into the database, then creates your staff login.

## 3. Run it

```bash
npm start
```

- Shop — <http://localhost:3000>
- Admin — <http://localhost:3000/admin>

`npm run dev` restarts automatically while you work.

---

## What the admin panel does

| Tab | What you can do |
| --- | --- |
| **Orders** | See every order with items, address and total. Change the status — the customer is emailed automatically, and you get an optional WhatsApp link. |
| **Products** | Add, edit or remove products. Upload the photo straight from your computer. Stock is edited inline. |
| **Categories** | Add or remove the category circles per department, with photos. |
| **Workshop** | Every fitting or repair request. Mark Confirmed / Done and the customer is emailed. |
| **Reviews** | Hide or delete anything you don't want on the site. |
| **Page text** | Edit the wording of any section without touching a file. |
| **Staff** | Add staff logins (admin only) and see every customer. |

## Emails that go out on their own

- Customer signs up → welcome email
- Customer signs in → sign-in notice
- Order placed → receipt to the customer, alert to `SHOP_EMAIL`
- Order marked Confirmed / Ready / Completed / Cancelled → update to the customer
- Workshop request → confirmation to the customer, alert to the shop
- Booking marked Confirmed / Done → update to the customer

Until you fill in the `SMTP_*` settings, emails are printed in the terminal and
stored in the `mail_log` table instead of being sent — so you can test freely.
When you're ready, use your email provider's SMTP details (Gmail, Zoho, your
host's mail service, SendGrid, Brevo — any of them work).

**WhatsApp:** set `SHOP_WHATSAPP` and the admin panel offers a one-click
`wa.me` message when you update an order. That opens WhatsApp with the message
written for you — no paid API needed.

## What the shop does now

- Products, prices, stock and categories come from the database
- Stock drops when an order is placed; the checkout refuses more than you have
- Orders are saved and appear in the customer's account
- Customers can create an account, sign in and see their orders and bookings
- Reviews are stored on the server and everyone sees them
- Ticking "add fitting" creates a workshop booking against the order

If the server isn't running the page still works on its own, saving to the
browser — handy for design work, but nothing reaches you.

## Money

Payment is cash / bank transfer / pay in store for now. The order records the
chosen method and the status flow covers the rest. Adding Stripe later is a
small job: one route, one key.

## Putting it online

Recommended: **Render** (<https://render.com>) — free tier, connects to GitHub,
no server admin.

1. Push this `server` folder to a GitHub repository.
2. On Render: **New → Web Service**, pick the repo.
3. Build command `npm install`, start command `npm start`.
4. Add the `.env` values under **Environment**.
5. Add a **Disk** mounted at `/opt/render/project/src/data` so the database and
   uploaded photos survive restarts.

Railway and Fly.io work the same way. Once it's live, point your domain at it.

## Backups

Everything lives in `data/rickice.db`. Copy that file somewhere safe now and
then — that is your whole shop. Uploaded photos are in `public/images/uploads/`.

## Files

```
server.js              the whole API and the site
db.js                  database tables
mailer.js              email + WhatsApp link
seed.js                loads the rickice-*.js files into the database
public/                the shop itself
public/admin.html      the admin panel
data/rickice.db        your database (created on first run)
```
