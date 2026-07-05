// server/botEngine.js
//
// This is the "inclusivity system" itself: one conversation engine, two channel
// adapters (ussd.js, whatsapp.js) sitting on top of it. A farmer on a feature
// phone dialing a USSD code and a farmer texting WhatsApp reach the exact same
// prices, buyers, and booking logic — nobody gets a second-class experience
// because of the phone they own.
//
// Menu state lives server-side, keyed per-user, so either channel can be
// stateless at the transport level (which matches how real USSD gateways and
// the WhatsApp Cloud API both work — they hand you raw input and a user id,
// nothing else).

const { db } = require('./db');

// ---- in-memory session state ------------------------------------------------
// USSD sessions are short-lived (one dial session). WhatsApp sessions persist
// between messages until the user finishes a flow. Both share this shape.
const sessions = new Map(); // key: `${channel}:${userKey}` -> { state, data }

function getSession(channel, userKey) {
  const key = `${channel}:${userKey}`;
  if (!sessions.has(key)) {
    sessions.set(key, { state: 'root', data: {} });
  }
  return sessions.get(key);
}

function resetSession(channel, userKey) {
  sessions.set(`${channel}:${userKey}`, { state: 'root', data: {} });
}

// ---- data helpers ------------------------------------------------------------
function listCrops() {
  return db.prepare('SELECT * FROM crops ORDER BY id').all();
}

function getPrice(cropId, zone = 'Ibadan-Zone A') {
  return db.prepare(
    'SELECT * FROM prices WHERE crop_id = ? AND zone = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(cropId, zone);
}

function getBuyers(cropId, zone = 'Ibadan-Zone A') {
  return db.prepare('SELECT * FROM buyers WHERE crop_id = ? AND zone = ?').all(cropId, zone);
}

function getCropById(id) {
  return db.prepare('SELECT * FROM crops WHERE id = ?').get(id);
}

function ensureFarmer(phone) {
  const existing = db.prepare('SELECT * FROM farmers WHERE phone = ?').get(phone);
  if (existing) return existing;
  db.prepare('INSERT INTO farmers (phone, zone, plan, created_at) VALUES (?, ?, ?, ?)')
    .run(phone, 'Ibadan-Zone A', 'none', new Date().toISOString());
  return db.prepare('SELECT * FROM farmers WHERE phone = ?').get(phone);
}

function createListing(phone, cropId, kg) {
  db.prepare(`
    INSERT INTO harvest_listings (farmer_phone, crop_id, kg, status, created_at)
    VALUES (?, ?, ?, 'open', ?)
  `).run(phone, cropId, kg, new Date().toISOString());
}

// ---- the menu tree -------------------------------------------------------
// Each screen returns { lines: [...], next: fn(input) => nextStateName | null }
// `render(state, session)` builds the text; `advance(state, input, session)`
// decides the next state and mutates session.data as needed.

function renderRoot() {
  return [
    'Welcome to BAO.',
    '1. Check today\'s price',
    '2. Buyers near you',
    '3. Report harvest ready',
    '4. Book a cool chamber (ZECC)',
    '5. My subscription',
  ];
}

function renderCropMenu() {
  const crops = listCrops();
  const lines = ['Select crop:'];
  crops.forEach((c, i) => lines.push(`${i + 1}. ${c.name}`));
  lines.push('0. Back');
  return lines;
}

function renderPrice(cropId, session) {
  const crop = getCropById(cropId);
  const price = getPrice(cropId);
  const gap = (price.market_price - price.farmer_price).toFixed(0);
  return [
    `${crop.name.toUpperCase()} — live`,
    `Reference market: N${price.market_price}/kg`,
    `Your zone avg: N${price.farmer_price}/kg`,
    `You're owed +N${gap}/kg`,
    '',
    '0. Back   9. See buyers',
  ];
}

function renderBuyers(cropId) {
  const buyers = cropId ? getBuyers(cropId) : [];
  const lines = ['Buyers near you:'];
  if (buyers.length === 0) {
    lines.push('(pick a crop first for a match)');
  } else {
    buyers.forEach((b, i) => lines.push(`${i + 1}. ${b.name}`));
  }
  lines.push('0. Back');
  return lines;
}

function renderConfirmed() {
  return [
    'Request sent.',
    'A buyer will call within 2hrs.',
    'Your harvest stays listed for',
    '72hrs or until sold.',
    '',
    '0. Back to menu',
  ];
}

function renderReportPrompt() {
  return [
    'Report harvest ready.',
    'Select crop:',
    ...listCrops().map((c, i) => `${i + 1}. ${c.name}`),
    '0. Back',
  ];
}

function renderReportKg(cropName) {
  return [
    `${cropName} selected.`,
    'Reply with estimated kg',
    '(e.g. 40), then Send.',
    '',
    '0. Back',
  ];
}

function renderReportDone(cropName, kg) {
  return [
    'Listed!',
    `${cropName} — ${kg}kg`,
    'is now visible to nearby',
    'buyers for 72hrs.',
    '',
    '0. Back to menu',
  ];
}

function renderZeccZones() {
  const chambers = db.prepare('SELECT * FROM zecc_chambers').all();
  const lines = ['Book a ZECC chamber:'];
  chambers.forEach((c, i) => {
    const free = c.capacity_kg - c.booked_kg;
    lines.push(`${i + 1}. ${c.zone} (${free}kg free)`);
  });
  lines.push('0. Back');
  return { lines, chambers };
}

function renderZeccKg() {
  return ['Enter kg to store,', 'then Send.', '', '0. Back'];
}

function renderZeccDone(zone, kg) {
  return [
    'Chamber booked.',
    `${zone} — ${kg}kg, 3 days.`,
    'Bring produce within',
    '24hrs to hold your slot.',
    '',
    '0. Back to menu',
  ];
}

function renderSubscription(farmer) {
  return [
    'My subscription',
    `Plan: ${farmer.plan === 'basic' ? 'BAO Basic — N200/mo' : 'None'}`,
    `Status: ${farmer.plan === 'basic' ? 'Active' : 'Not subscribed'}`,
    '',
    farmer.plan === 'basic' ? '1. Cancel plan' : '1. Subscribe (N200/mo)',
    '0. Back',
  ];
}

// ---- the state machine -----------------------------------------------------
// handleInput is the single entry point both adapters call.
function handleInput(channel, userKey, rawInput) {
  const session = getSession(channel, userKey);
  const input = (rawInput || '').trim();
  const farmer = ensureFarmer(userKey);
  let lines;
  let end = false;

  const goRoot = () => { session.state = 'root'; session.data = {}; lines = renderRoot(); };

  switch (session.state) {
    case 'root': {
      if (input === '1') { session.state = 'crop_menu_price'; lines = renderCropMenu(); }
      else if (input === '2') { session.state = 'buyers'; lines = renderBuyers(null); }
      else if (input === '3') { session.state = 'report_crop'; lines = renderReportPrompt(); }
      else if (input === '4') { const z = renderZeccZones(); session.data.chambers = z.chambers; session.state = 'zecc_zone'; lines = z.lines; }
      else if (input === '5') { session.state = 'subscription'; lines = renderSubscription(farmer); }
      else { lines = renderRoot(); }
      break;
    }

    case 'crop_menu_price': {
      const crops = listCrops();
      const idx = parseInt(input, 10) - 1;
      if (input === '0') { goRoot(); }
      else if (crops[idx]) {
        session.data.cropId = crops[idx].id;
        session.state = 'price_view';
        lines = renderPrice(crops[idx].id, session);
      } else {
        lines = renderCropMenu();
      }
      break;
    }

    case 'price_view': {
      if (input === '0') { goRoot(); }
      else if (input === '9') { session.state = 'buyers'; lines = renderBuyers(session.data.cropId); }
      else { lines = renderPrice(session.data.cropId, session); }
      break;
    }

    case 'buyers': {
      const buyers = session.data.cropId ? getBuyers(session.data.cropId) : [];
      const idx = parseInt(input, 10) - 1;
      if (input === '0') { goRoot(); }
      else if (buyers[idx]) { session.state = 'confirmed'; lines = renderConfirmed(); }
      else { lines = renderBuyers(session.data.cropId); }
      break;
    }

    case 'confirmed': {
      if (input === '0') { goRoot(); } else { lines = renderConfirmed(); }
      break;
    }

    case 'report_crop': {
      const crops = listCrops();
      const idx = parseInt(input, 10) - 1;
      if (input === '0') { goRoot(); }
      else if (crops[idx]) {
        session.data.reportCropId = crops[idx].id;
        session.data.reportCropName = crops[idx].name;
        session.state = 'report_kg';
        lines = renderReportKg(crops[idx].name);
      } else { lines = renderReportPrompt(); }
      break;
    }

    case 'report_kg': {
      if (input === '0') { goRoot(); }
      else {
        const kg = parseFloat(input);
        if (!isNaN(kg) && kg > 0) {
          createListing(userKey, session.data.reportCropId, kg);
          lines = renderReportDone(session.data.reportCropName, kg);
          session.state = 'report_done';
        } else {
          lines = renderReportKg(session.data.reportCropName);
        }
      }
      break;
    }

    case 'report_done': { goRoot(); break; }

    case 'zecc_zone': {
      const chambers = session.data.chambers || [];
      const idx = parseInt(input, 10) - 1;
      if (input === '0') { goRoot(); }
      else if (chambers[idx]) {
        session.data.chamberId = chambers[idx].id;
        session.data.chamberZone = chambers[idx].zone;
        session.state = 'zecc_kg';
        lines = renderZeccKg();
      } else {
        const z = renderZeccZones();
        lines = z.lines;
      }
      break;
    }

    case 'zecc_kg': {
      if (input === '0') { goRoot(); }
      else {
        const kg = parseFloat(input);
        if (!isNaN(kg) && kg > 0) {
          db.prepare(`
            INSERT INTO zecc_bookings (chamber_id, farmer_phone, farmer_name, kg, start_date, days, status, created_at)
            VALUES (?, ?, ?, ?, ?, 3, 'confirmed', ?)
          `).run(session.data.chamberId, userKey, farmer.name || userKey, kg, new Date().toISOString(), new Date().toISOString());
          db.prepare('UPDATE zecc_chambers SET booked_kg = booked_kg + ? WHERE id = ?')
            .run(kg, session.data.chamberId);
          lines = renderZeccDone(session.data.chamberZone, kg);
          session.state = 'zecc_done';
        } else {
          lines = renderZeccKg();
        }
      }
      break;
    }

    case 'zecc_done': { goRoot(); break; }

    case 'subscription': {
      if (input === '0') { goRoot(); }
      else if (input === '1') {
        const newPlan = farmer.plan === 'basic' ? 'none' : 'basic';
        db.prepare('UPDATE farmers SET plan = ? WHERE phone = ?').run(newPlan, userKey);
        const updated = { ...farmer, plan: newPlan };
        lines = renderSubscription(updated);
      } else {
        lines = renderSubscription(farmer);
      }
      break;
    }

    default: {
      goRoot();
    }
  }

  // log both directions for the admin dashboard
  logMessage(channel, userKey, 'in', input || '(session start)');
  const reply = lines.join('\n');
  logMessage(channel, userKey, 'out', reply);

  return { reply, endSession: end, state: session.state };
}

function logMessage(channel, phone, direction, text) {
  db.prepare(`
    INSERT INTO message_log (channel, phone, direction, text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(channel, phone, direction, text, new Date().toISOString());
}

module.exports = { handleInput, resetSession, listCrops, getPrice };
