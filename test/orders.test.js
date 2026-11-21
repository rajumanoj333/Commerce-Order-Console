const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/store');
const { OrderService } = require('../src/service');
const { seedState } = require('../src/seed');
const { createServer } = require('../src/server');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-')), 'db.json');
}
const fresh = (file = tmpFile()) => new OrderService(new JsonStore(file), seedState);
const stock = (svc, id) => svc.listProducts().find((p) => p.id === id).stock;

test('successful placement deducts stock, computes total, persists across restart', () => {
  const file = tmpFile();
  const svc = fresh(file);
  const o = svc.placeOrder({ customer: 'Ann', items: [{ productId: 'P-A', quantity: 2 }, { productId: 'P-D', quantity: 1 }] });
  assert.equal(o.status, 'Placed');
  assert.equal(o.total, 21.25);
  assert.equal(stock(svc, 'P-A'), 3);
  const restarted = fresh(file);
  assert.equal(stock(restarted, 'P-A'), 3);
  assert.equal(restarted.getOrder(o.ref).total, 21.25);
});

test('insufficient stock rejects whole order and changes nothing', () => {
  const svc = fresh();
  assert.throws(
    () => svc.placeOrder({ customer: 'Bob', items: [{ productId: 'P-A', quantity: 2 }, { productId: 'P-B', quantity: 1 }] }),
    (e) => e.status === 409 && e.details.some((d) => d.productId === 'P-B')
  );
  assert.equal(stock(svc, 'P-A'), 5);
  assert.equal(svc.listOrders().length, 0);
});

test('duplicate lines for one product are merged before the stock check', () => {
  const svc = fresh();
  assert.throws(() => svc.placeOrder({ customer: 'C', items: [{ productId: 'P-A', quantity: 3 }, { productId: 'P-A', quantity: 3 }] }), (e) => e.status === 409);
  assert.equal(stock(svc, 'P-A'), 5);
});

test('invalid transitions are rejected (skip, backwards, from terminal)', () => {
  const svc = fresh();
  const o = svc.placeOrder({ customer: 'D', items: [{ productId: 'P-C', quantity: 1 }] });
  assert.throws(() => svc.transition(o.ref, 'Shipped'), (e) => e.status === 409);
  svc.transition(o.ref, 'Packed');
  assert.throws(() => svc.transition(o.ref, 'Placed'), (e) => e.status === 409);
  svc.transition(o.ref, 'Shipped');
  assert.throws(() => svc.transition(o.ref, 'Cancelled'), (e) => e.status === 409);
  assert.equal(stock(svc, 'P-C'), 39);
});

test('cancel restores stock exactly once', () => {
  const svc = fresh();
  const o = svc.placeOrder({ customer: 'E', items: [{ productId: 'P-A', quantity: 2 }] });
  assert.equal(stock(svc, 'P-A'), 3);
  svc.transition(o.ref, 'Cancelled');
  assert.equal(stock(svc, 'P-A'), 5);
  assert.throws(() => svc.transition(o.ref, 'Cancelled'), (e) => e.status === 409);
  assert.equal(stock(svc, 'P-A'), 5);
});

test('search by reference and status filter', () => {
  const svc = fresh();
  const a = svc.placeOrder({ customer: 'F', items: [{ productId: 'P-D', quantity: 1 }] });
  svc.placeOrder({ customer: 'G', items: [{ productId: 'P-D', quantity: 1 }] });
  svc.transition(a.ref, 'Packed');
  assert.equal(svc.listOrders({ q: '0001' }).length, 1);
  assert.equal(svc.listOrders({ status: 'Packed' }).length, 1);
  assert.equal(svc.listOrders({ status: 'Placed' }).length, 1);
});

test('HTTP API enforces the same rules', async () => {
  const svc = fresh();
  const server = createServer(svc).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = (p, method = 'GET', body) =>
    fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  try {
    let r = await call('/api/orders', 'POST', { customer: 'H', items: [{ productId: 'P-A', quantity: 1 }, { productId: 'P-B', quantity: 1 }] });
    assert.equal(r.status, 409);
    r = await call('/api/orders', 'POST', { customer: 'H', items: [{ productId: 'P-A', quantity: 1 }] });
    assert.equal(r.status, 201);
    const { ref } = await r.json();
    r = await call(`/api/orders/${ref}/status`, 'POST', { status: 'Shipped' });
    assert.equal(r.status, 409);
    r = await call('/api/orders', 'POST', { customer: '', items: [] });
    assert.equal(r.status, 400);
  } finally {
    server.close();
  }
});
