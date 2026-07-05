// server/index.js
// Plain node:http server — no Express, no npm install required.
// Run with: node server/index.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const routes = require('./routes');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  // prevent path traversal outside /public
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// simple route table: [method, exact-or-regex path, handler, paramNames]
const routeTable = [
  ['GET', /^\/api\/crops$/, routes.apiCrops],
  ['GET', /^\/api\/prices$/, routes.apiPrices],
  ['PATCH', /^\/api\/prices\/(\d+)$/, routes.apiUpdatePrice, ['id']],
  ['GET', /^\/api\/buyers$/, routes.apiBuyers],
  ['GET', /^\/api\/listings$/, routes.apiListings],
  ['GET', /^\/api\/zecc\/chambers$/, routes.apiZeccChambers],
  ['GET', /^\/api\/zecc\/bookings$/, routes.apiZeccBookings],
  ['POST', /^\/api\/zecc\/book$/, routes.apiZeccBook],
  ['GET', /^\/api\/messages$/, routes.apiMessageLog],
  ['GET', /^\/api\/stream$/, routes.handleSSE],
  ['POST', /^\/ussd$/, routes.handleUSSD],
  ['POST', /^\/webhook\/whatsapp$/, routes.handleWhatsAppWebhook],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  for (const [method, regex, handler, paramNames] of routeTable) {
    if (req.method !== method) continue;
    const match = pathname.match(regex);
    if (!match) continue;

    const params = {};
    if (paramNames) paramNames.forEach((name, i) => (params[name] = match[i + 1]));

    try {
      return await handler(req, res, params, url);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`BAO server running → http://localhost:${PORT}`);
  console.log(`  Landing:    http://localhost:${PORT}/`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard.html`);
  console.log(`  USSD sim:   http://localhost:${PORT}/ussd.html`);
  console.log(`  WhatsApp:   http://localhost:${PORT}/whatsapp.html`);
  console.log(`  ZECC book:  http://localhost:${PORT}/zecc.html`);
});
