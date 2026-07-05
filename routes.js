// server/routes.js
const { db } = require('./db');
const { handleInput, resetSession } = require('./botEngine');

// ---- SSE (real-time sync) --------------------------------------------------
// Every connected dashboard/simulator tab holds one open response. When a
// price changes anywhere, we push it to all of them instantly — this is the
// "real-time price sync" from the brief, done with zero external libraries.
const sseClients = new Set();

function sseBroadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(data);
  }
}

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

// ---- small helpers ----------------------------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => (chunks += c));
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function parseFormEncoded(raw) {
  const out = {};
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  }
  return out;
}

// ---- REST API (used by the trader/admin dashboard + booking page) --------
async function apiCrops(req, res) {
  sendJSON(res, 200, db.prepare('SELECT * FROM crops ORDER BY id').all());
}

async function apiPrices(req, res) {
  const rows = db.prepare(`
    SELECT p.id, c.name AS crop, p.zone, p.market_price, p.farmer_price, p.updated_at
    FROM prices p JOIN crops c ON c.id = p.crop_id
    ORDER BY c.id
  `).all();
  sendJSON(res, 200, rows);
}

async function apiUpdatePrice(req, res, params) {
  const body = await readJSON(req);
  const { farmer_price, market_price } = body;
  const id = Number(params.id);
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM prices WHERE id = ?').get(id);
  if (!existing) return sendJSON(res, 404, { error: 'Price row not found' });

  db.prepare(`
    UPDATE prices SET
      farmer_price = COALESCE(?, farmer_price),
      market_price = COALESCE(?, market_price),
      updated_at = ?
    WHERE id = ?
  `).run(farmer_price ?? null, market_price ?? null, now, id);

  const updated = db.prepare(`
    SELECT p.id, c.name AS crop, p.zone, p.market_price, p.farmer_price, p.updated_at
    FROM prices p JOIN crops c ON c.id = p.crop_id WHERE p.id = ?
  `).get(id);

  sseBroadcast('price_update', updated);
  sendJSON(res, 200, updated);
}

async function apiBuyers(req, res) {
  sendJSON(res, 200, db.prepare(`
    SELECT b.id, b.name, c.name AS crop, b.zone, b.phone
    FROM buyers b JOIN crops c ON c.id = b.crop_id
  `).all());
}

async function apiListings(req, res) {
  sendJSON(res, 200, db.prepare(`
    SELECT l.id, l.farmer_phone, c.name AS crop, l.kg, l.status, l.created_at
    FROM harvest_listings l JOIN crops c ON c.id = l.crop_id
    ORDER BY l.created_at DESC LIMIT 50
  `).all());
}

async function apiZeccChambers(req, res) {
  sendJSON(res, 200, db.prepare('SELECT * FROM zecc_chambers').all());
}

async function apiZeccBookings(req, res) {
  sendJSON(res, 200, db.prepare(`
    SELECT bk.id, ch.name AS chamber, ch.zone, bk.farmer_name, bk.farmer_phone,
           bk.kg, bk.start_date, bk.days, bk.status
    FROM zecc_bookings bk JOIN zecc_chambers ch ON ch.id = bk.chamber_id
    ORDER BY bk.created_at DESC LIMIT 50
  `).all());
}

async function apiZeccBook(req, res) {
  const body = await readJSON(req);
  const { chamber_id, farmer_name, farmer_phone, kg, days } = body;
  if (!chamber_id || !farmer_phone || !kg) {
    return sendJSON(res, 400, { error: 'chamber_id, farmer_phone and kg are required' });
  }
  const chamber = db.prepare('SELECT * FROM zecc_chambers WHERE id = ?').get(chamber_id);
  if (!chamber) return sendJSON(res, 404, { error: 'Chamber not found' });

  const free = chamber.capacity_kg - chamber.booked_kg;
  if (kg > free) return sendJSON(res, 409, { error: `Only ${free}kg free in this chamber` });

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO zecc_bookings (chamber_id, farmer_phone, farmer_name, kg, start_date, days, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(chamber_id, farmer_phone, farmer_name || farmer_phone, kg, now, days || 3, now);

  db.prepare('UPDATE zecc_chambers SET booked_kg = booked_kg + ? WHERE id = ?').run(kg, chamber_id);

  const updatedChamber = db.prepare('SELECT * FROM zecc_chambers WHERE id = ?').get(chamber_id);
  sseBroadcast('zecc_update', updatedChamber);
  sendJSON(res, 201, { ok: true, chamber: updatedChamber });
}

async function apiMessageLog(req, res) {
  sendJSON(res, 200, db.prepare(`
    SELECT * FROM message_log ORDER BY created_at DESC LIMIT 40
  `).all());
}

// ---- USSD adapter -----------------------------------------------------------
// Contract mirrors common gateway callbacks (e.g. Africa's Talking): the
// gateway POSTs sessionId, phoneNumber and the input text, and expects a
// plain-text response prefixed CON (keep session open) or END (hang up).
// Session state itself is kept here, server-side, keyed by sessionId — so
// this endpoint is stateless from the gateway's point of view, which is
// exactly what real USSD gateways expect.
async function handleUSSD(req, res) {
  const raw = await readBody(req);
  const ct = req.headers['content-type'] || '';
  const params = ct.includes('application/json') ? JSON.parse(raw || '{}') : parseFormEncoded(raw);
  const { sessionId, phoneNumber, text } = params;

  if (!sessionId || !phoneNumber) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('END Missing sessionId or phoneNumber');
  }

  // gateways send the FULL accumulated input each time, separated by *.
  // We only need the newest segment since our state lives server-side.
  const segments = (text || '').split('*').filter(Boolean);
  const lastInput = segments.length ? segments[segments.length - 1] : '';

  const { reply, state } = handleInput('ussd', phoneNumber, lastInput);
  const prefix = state === 'root' && lastInput === '' ? 'CON' : 'CON';
  const isTerminal = false; // this demo keeps the menu open; real deployments may END on logout

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`${isTerminal ? 'END' : 'CON'} ${reply}`);
}

// ---- WhatsApp adapter --------------------------------------------------------
// Contract mirrors the WhatsApp Cloud API webhook payload shape. In a live
// deployment, after computing `reply` you'd POST it to
// https://graph.facebook.com/v19.0/<phone_number_id>/messages
// with your access token — that call is stubbed below (see sendWhatsApp).
async function handleWhatsAppWebhook(req, res) {
  const body = await readJSON(req);

  let from, text;
  try {
    const msg = body.entry[0].changes[0].value.messages[0];
    from = msg.from;
    text = msg.text.body;
  } catch {
    // also accept a simplified shape for our own simulator UI
    from = body.from;
    text = body.text;
  }

  if (!from) return sendJSON(res, 400, { error: 'No sender phone number found in payload' });

  const { reply } = handleInput('whatsapp', from, text || '');
  await sendWhatsApp(from, reply); // stubbed — see function below
  sendJSON(res, 200, { reply });
}

async function sendWhatsApp(to, message) {
  // Real integration point. Left commented so this is genuinely plug-and-play
  // once you have a WhatsApp Business account + access token:
  //
  // await fetch(`https://graph.facebook.com/v19.0/${process.env.WA_PHONE_ID}/messages`, {
  //   method: 'POST',
  //   headers: {
  //     Authorization: `Bearer ${process.env.WA_TOKEN}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     messaging_product: 'whatsapp',
  //     to,
  //     text: { body: message },
  //   }),
  // });
  return Promise.resolve();
}

module.exports = {
  handleSSE,
  sseBroadcast,
  apiCrops,
  apiPrices,
  apiUpdatePrice,
  apiBuyers,
  apiListings,
  apiZeccChambers,
  apiZeccBookings,
  apiZeccBook,
  apiMessageLog,
  handleUSSD,
  handleWhatsAppWebhook,
};
