# BAO — full-stack build

The market coordination half of the BAO pitch, actually running: a hybrid
USSD/WhatsApp channel with real-time price sync, plus a minimal ZECC booking
flow. No cloud services, no API keys, no npm install — it runs anywhere with
Node 22+.

## Run it

```bash
npm start
# or: node server/index.js
```

Then open:

| Page | URL | Who it's for |
|---|---|---|
| Overview | `http://localhost:3000/` | you |
| Trader dashboard | `/dashboard.html` | the person setting prices |
| USSD simulator | `/ussd.html` | a farmer on a feature phone |
| WhatsApp simulator | `/whatsapp.html` | a farmer on a smartphone |
| ZECC booking | `/zecc.html` | anyone reserving cold storage |

Open the dashboard and the USSD simulator side by side, change a price on the
dashboard, and watch the USSD page's ticker update with no refresh. That's
the real-time sync working.

## Why it's built this way

**One backend, two doors in.** `server/botEngine.js` is the entire
conversation — menu text, state transitions, price lookups, bookings. Neither
`server/routes.js`'s `handleUSSD` nor `handleWhatsAppWebhook` contains any of
that logic; they just translate their channel's request shape into a call to
`handleInput(channel, userKey, input)` and hand the reply back in whatever
format that channel expects. That's the actual "inclusivity system" from the
pitch — not two separate bots that happen to look similar, one engine two
adapters.

**Real gateway shapes, not invented ones.**
- `POST /ussd` expects `{ sessionId, phoneNumber, text }` and returns
  `CON ...` / `END ...` plain text — this is the exact contract used by
  USSD aggregators like Africa's Talking. Point a real aggregator's callback
  URL at this endpoint (with matching session-state handling) and the wiring
  doesn't change.
- `POST /webhook/whatsapp` accepts the WhatsApp Cloud API's webhook payload
  shape (`entry[0].changes[0].value.messages[0]`), falling back to a simpler
  `{ from, text }` shape for the simulator. `sendWhatsApp()` in
  `routes.js` is where you'd add the real `graph.facebook.com` call once you
  have a WhatsApp Business account and access token — it's stubbed and
  commented, not faked.

**Real-time sync without a framework.** `GET /api/stream` is a raw
Server-Sent Events endpoint — no Socket.IO, no polling hack. When a trader
edits a price, `routes.js` broadcasts a `price_update` event to every open
connection. `public/js/ticker.js` is the ~20-line client that listens for it.

**One database, no ORM.** `server/db.js` uses Node's built-in `node:sqlite`
(stable since Node 22.5), so there's nothing to `npm install`. Schema and
seed data live in one place; open `data/bao.db` with any SQLite browser if
you want to poke at it directly.

**ZECC is deliberately thin.** Storage chambers are physical infrastructure —
a website can't extend anyone's shelf life. So `zecc.html` and the
`/api/zecc/*` routes only do what a booking system reasonably should: show
free capacity per zone and reserve a slot. The same booking flow is also
reachable as option 4 inside both the USSD and WhatsApp menus, so it's not a
second disconnected feature.

## Project layout

```
server/
  index.js       → HTTP server + router (plain node:http, no Express)
  routes.js       → REST API, USSD adapter, WhatsApp adapter, SSE broadcast
  botEngine.js    → the shared conversation engine (the actual product)
  db.js           → schema + seed data (node:sqlite)
public/
  index.html, dashboard.html, ussd.html, whatsapp.html, zecc.html
  css/style.css
  js/ (one small file per page, plus shared toast.js and ticker.js)
data/
  bao.db          → created on first run, gitignore this in a real repo
```

## Extending this

- **Real USSD**: sign up with an aggregator (Africa's Talking, or a Nigerian
  telco directly), point their callback at `/ussd`, done.
- **Real WhatsApp**: create a Meta developer app + WhatsApp Business account,
  set `WA_PHONE_ID` / `WA_TOKEN` env vars, uncomment the `fetch` call in
  `sendWhatsApp()`.
- **Multiple zones**: `prices` and `buyers` are already zone-scoped in the
  schema; the menu currently hardcodes `'Ibadan-Zone A'` in a couple of
  places in `botEngine.js` — swap that for the farmer's registered zone once
  you're collecting it at signup.
- **Persistence across restarts**: it already persists — `data/bao.db` is a
  real file, not in-memory. Delete it to reset to the seed data.
