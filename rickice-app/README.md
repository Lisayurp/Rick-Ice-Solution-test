# Rick Ice Solutions — the real website

Shop + database + admin panel. Node, Express and Postgres, built to run on Vercel
(product/barcode photos live in Vercel Blob storage).

---

## 1. Install

You need Node 18 or newer (https://nodejs.org — take the LTS download), and a
Postgres database + Blob store from the Vercel dashboard (**Storage → Create
Database**, once for Postgres and once for Blob). Connecting them to your
Vercel project fills in `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` for you in
production — for local development, copy those same values into your `.env`.

```bash
cd rickice-app
npm install
cp env.example.txt .env        # Windows:  copy env.example.txt .env
```

Open `.env` and set at least `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`,
`POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN`.

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

## Putting it online (Vercel)

1. Push this `rickice-app` folder to a GitHub repository.
2. On [vercel.com](https://vercel.com): **New Project**, pick the repo.
3. Before the first deploy, go to the project's **Storage** tab and create a
   **Postgres** database and a **Blob** store, connecting both to this
   project — Vercel sets `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN`
   automatically.
4. Under **Settings → Environment Variables**, add the rest of your `.env`
   values (`SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SHOP_EMAIL`,
   `SHOP_WHATSAPP`, `SMTP_*`, `MAIL_FROM`).
5. Deploy. Vercel detects `api/index.js` automatically — no build step needed.
6. Run `npm run seed` **once from your own machine**, pointed at the same
   `POSTGRES_URL` as production (in your local `.env`), to create the admin
   login and load starting products/categories/wording.

Point your domain at the Vercel project whenever you're ready (**Settings →
Domains**).

## Backups

Everything lives in your Postgres database (Vercel dashboard → Storage → your
database → Backups) — that's your whole shop. Uploaded photos live separately
in Vercel Blob storage.

## Files

```
server.js              the whole API and the site (exports the Express app)
api/index.js            the Vercel serverless function entry point
vercel.json              routes static files + /api/* on Vercel
db.js                   database schema + query helpers (Postgres)
mailer.js               email + WhatsApp link
seed.js                 loads the rickice-*.js files into the database
public/                 the shop itself (served as static files on Vercel)
public/admin.html       the admin panel
```
