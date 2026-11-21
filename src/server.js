const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { JsonStore, prepareDataFile } = require('./store');
const { OrderService, ApiError } = require('./service');
const { dispatch } = require('./api');
const { seedState } = require('./seed');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        chunks.length = 0;
        reject(new ApiError(413, 'Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > 1e6) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error();
        }
        resolve(body);
      } catch {
        reject(new ApiError(400, 'Request body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

function createServer(service) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      let p;
      try {
        p = decodeURIComponent(url.pathname);
      } catch {
        throw new ApiError(400, 'Invalid URL encoding');
      }
      if (p.startsWith('/api/')) {
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        const result = dispatch(service, req.method, p, url.searchParams, body);
        return send(result.status, result.body);
      }
      if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed');
      const file = path.resolve(PUBLIC, p === '/' ? 'index.html' : '.' + p);
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ApiError(404, 'Not found');
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
  const file = prepareDataFile();
  const service = new OrderService(new JsonStore(file), seedState);
  const host = '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const server = createServer(service);
  server.listen(port, host, () => {
    console.log(`Order console on http://${host}:${server.address().port}`);
  });
}
