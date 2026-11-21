const sdk = require('@vercel/blob');
const { dispatch } = require('../src/api');
const { withBlobState } = require('../src/blob-store');
const { ApiError } = require('../src/service');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = req.query?.route || url.searchParams.get('route');
    const pathname = route ? '/api/' + route : url.pathname;
    let body;
    if (req.method === 'POST') {
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch {
        throw new ApiError(400, 'Request body must be a JSON object');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'Request body must be a JSON object');
      }
      if (Buffer.byteLength(JSON.stringify(body)) > 1e6) throw new ApiError(413, 'Body too large');
    }
    const result = await withBlobState(sdk, service =>
      dispatch(service, req.method, pathname, url.searchParams, body));
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.status).json({ error: error.message, details: error.details });
    }
    console.error('Stockroom storage request failed', error.name);
    return res.status(503).json({ error: 'Order storage is unavailable. Refresh to check the latest order state.' });
  }
};
