const { ApiError, TRANSITIONS } = require('./service');

function dispatch(service, method, pathname, query, body) {
  if (method === 'GET') {
    if (pathname === '/api/products') return { status: 200, body: service.listProducts() };
    if (pathname === '/api/transitions') return { status: 200, body: TRANSITIONS };
    if (pathname === '/api/orders') {
      return { status: 200, body: service.listOrders({ q: query.get('q'), status: query.get('status') }) };
    }
    const detail = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (detail) return { status: 200, body: service.getOrder(detail[1]) };
  }
  if (method === 'POST') {
    if (pathname === '/api/orders') return { status: 201, body: service.placeOrder(body) };
    const update = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (update) return { status: 200, body: service.transition(update[1], body.status) };
  }
  throw new ApiError(404, 'Not found');
}

module.exports = { dispatch };
