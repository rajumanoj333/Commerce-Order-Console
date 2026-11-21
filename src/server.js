const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { JsonStore } = require('./store');
const { OrderService, ApiError, TRANSITIONS } = require('./service');
const { seedState } = require('./seed');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new ApiError(413, 'Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new ApiError(400, 'Invalid JSON')); }
    });
  });
}

function createServer(service) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (p.startsWith('/api/')) {
        if (req.method === 'GET' && p === '/api/products') return send(200, service.listProducts());
        if (req.method === 'GET' && p === '/api/transitions') return send(200, TRANSITIONS);
        if (req.method === 'GET' && p === '/api/orders') {
          return send(200, service.listOrders({ q: url.searchParams.get('q'), status: url.searchParams.get('status') }));
        }
        if (req.method === 'POST' && p === '/api/orders') return send(201, service.placeOrder(await readBody(req)));
        let m = p.match(/^\/api\/orders\/([^/]+)$/);
        if (req.method === 'GET' && m) return send(200, service.getOrder(decodeURIComponent(m[1])));
        m = p.match(/^\/api\/orders\/([^/]+)\/status$/);
        if (req.method === 'POST' && m) {
          const body = await readBody(req);
          return send(200, service.transition(decodeURIComponent(m[1]), body.status));
        }
        throw new ApiError(404, 'Not found');
      }
      if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed');
      const file = path.join(PUBLIC, p === '/' ? 'index.html' : path.normalize(p));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new ApiError(404, 'Not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (e instanceof ApiError) return send(e.status, { error: e.message, details: e.details });
      console.error(e);
      send(500, { error: 'Internal server error' });
    }
  });
}

module.exports = { createServer };

if (require.main === module) {
  const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');
  const service = new OrderService(new JsonStore(file), seedState);
  const port = process.env.PORT || 3000;
  createServer(service).listen(port, () => console.log(`Order console on http://localhost:${port}`));
}
