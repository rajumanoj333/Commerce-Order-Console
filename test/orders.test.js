const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/store');
const { OrderService } = require('../src/service');
const { seedState } = require('../src/seed');
const { createServer } = require('../src/server');

function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'db.json');
}
const fresh = (file) => new OrderService(new JsonStore(file), seedState);
const stock = (svc, id) => svc.listProducts().find((p) => p.id === id).stock;

test('successful placement deducts stock, computes total, persists across restart', (t) => {
  const file = tmpFile(t);
  const svc = fresh(file);
  const o = svc.placeOrder({ customer: 'Ann', items: [{ productId: 'P-A', quantity: 2 }, { productId: 'P-D', quantity: 1 }] });
  assert.equal(o.status, 'Placed');
  assert.equal(o.total, 21.25);
  assert.equal(stock(svc, 'P-A'), 3);
  const restarted = fresh(file);
  assert.equal(stock(restarted, 'P-A'), 3);
  assert.equal(restarted.getOrder(o.ref).total, 21.25);
});

test('insufficient stock rejects whole order and changes nothing', (t) => {
  const svc = fresh(tmpFile(t));
  assert.throws(
    () => svc.placeOrder({ customer: 'Bob', items: [{ productId: 'P-A', quantity: 2 }, { productId: 'P-B', quantity: 1 }] }),
    (e) => e.status === 409 && e.details.some((d) => d.productId === 'P-B')
  );
  assert.equal(stock(svc, 'P-A'), 5);
  assert.equal(svc.listOrders().length, 0);
});

test('duplicate lines for one product are merged before the stock check', (t) => {
  const svc = fresh(tmpFile(t));
  assert.throws(() => svc.placeOrder({ customer: 'C', items: [{ productId: 'P-A', quantity: 3 }, { productId: 'P-A', quantity: 3 }] }), (e) => e.status === 409);
  assert.equal(stock(svc, 'P-A'), 5);
});

test('invalid transitions are rejected (skip, backwards, from terminal)', (t) => {
  const svc = fresh(tmpFile(t));
  const o = svc.placeOrder({ customer: 'D', items: [{ productId: 'P-C', quantity: 1 }] });
  assert.throws(() => svc.transition(o.ref, 'Shipped'), (e) => e.status === 409);
  svc.transition(o.ref, 'Packed');
  assert.throws(() => svc.transition(o.ref, 'Placed'), (e) => e.status === 409);
  svc.transition(o.ref, 'Shipped');
  assert.throws(() => svc.transition(o.ref, 'Cancelled'), (e) => e.status === 409);
  assert.equal(stock(svc, 'P-C'), 39);
});

test('cancel restores stock exactly once', (t) => {
  const svc = fresh(tmpFile(t));
  const o = svc.placeOrder({ customer: 'E', items: [{ productId: 'P-A', quantity: 2 }] });
  assert.equal(stock(svc, 'P-A'), 3);
  svc.transition(o.ref, 'Cancelled');
  assert.equal(stock(svc, 'P-A'), 5);
  assert.throws(() => svc.transition(o.ref, 'Cancelled'), (e) => e.status === 409);
  assert.equal(stock(svc, 'P-A'), 5);
});

test('search by reference and status filter', (t) => {
  const svc = fresh(tmpFile(t));
  const a = svc.placeOrder({ customer: 'F', items: [{ productId: 'P-D', quantity: 1 }] });
  svc.placeOrder({ customer: 'G', items: [{ productId: 'P-D', quantity: 1 }] });
  svc.transition(a.ref, 'Packed');
  assert.equal(svc.listOrders({ q: '0001' }).length, 1);
  assert.equal(svc.listOrders({ status: 'Packed' }).length, 1);
  assert.equal(svc.listOrders({ status: 'Placed' }).length, 1);
});

async function startApi(t, file) {
  const server = createServer(fresh(file));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async function request(route, body) {
    const options = body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    const response = await fetch(base + route, options);
    return { status: response.status, data: await response.json() };
  };
}

const line = (productId, quantity) => ({ productId, quantity });

test('HTTP placement errors report the unavailable item and preserve the full catalogue and order list', async (t) => {
  const file = tmpFile(t);
  const request = await startApi(t, file);
  const before = await request('/api/products');
  const failed = await request('/api/orders', { customer: 'H', items: [line('P-A', 2), line('P-B', 1)] });
  assert.equal(failed.status, 409);
  assert.ok(failed.data.details.some(item => item.productId === 'P-B' && item.available === 0));
  assert.deepEqual(await request('/api/products'), before);
  assert.deepEqual(await request('/api/orders'), { status: 200, data: [] });
  const reopened = fresh(file);
  assert.deepEqual(reopened.listProducts(), before.data);
  assert.deepEqual(reopened.listOrders(), []);
});

test('HTTP detail and search reflect fulfilment history and stock is restored once from Packed', async (t) => {
  const file = tmpFile(t);
  const request = await startApi(t, file);
  const before = (await request('/api/products')).data;
  const placed = await request('/api/orders', { customer: 'Lee', items: [line('P-A', 2), line('P-C', 1)] });
  assert.equal(placed.status, 201);
  const detailPath = `/api/orders/${placed.data.ref}`;
  assert.deepEqual((await request(detailPath)).data, placed.data);
  assert.deepEqual(placed.data.items.map(item => item.quantity), [2, 1]);
  assert.equal(placed.data.status, 'Placed');
  assert.equal(placed.data.customer, 'Lee');
  const update = status => request(detailPath + '/status', { status });
  assert.equal((await update('Shipped')).status, 409);
  assert.deepEqual((await request(detailPath)).data, placed.data);
  assert.equal((await update('Packed')).status, 200);
  const query = `/api/orders?q=${placed.data.ref.toLowerCase()}`;
  assert.deepEqual((await request(query + '&status=Placed')).data, []);
  const packed = await request(query + '&status=Packed');
  assert.deepEqual(packed.data.map(order => order.ref), [placed.data.ref]);
  const cancellations = await Promise.all([update('Cancelled'), update('Cancelled')]);
  assert.deepEqual(cancellations.map(result => result.status).sort(), [200, 409]);
  const reopened = fresh(file);
  assert.deepEqual(reopened.listProducts(), before);
  assert.deepEqual(reopened.getOrder(placed.data.ref).history.map(event => event.status), ['Placed', 'Packed', 'Cancelled']);
});

test('simultaneous callers cannot buy the same final units', async (t) => {
  const file = tmpFile(t);
  const request = await startApi(t, file);
  const responses = await Promise.all(['Ann', 'Morgan'].map(customer =>
    request('/api/orders', { customer, items: [line('P-A', 4)] })
  ));
  assert.deepEqual(responses.map(result => result.status).sort(), [201, 409]);
  const reopened = fresh(file);
  assert.equal(stock(reopened, 'P-A'), 1);
  assert.equal(reopened.listOrders().length, 1);
  assert.equal(reopened.listOrders()[0].items[0].quantity, 4);
});

test('HTTP rejects invalid order fields without modifying disk state', async (t) => {
  const file = tmpFile(t);
  const request = await startApi(t, file);
  const before = fs.readFileSync(file, 'utf8');
  const invalid = [
    null,
    [],
    { customer: ' ', items: [line('P-A', 1)] },
    { customer: 'Lee', items: [] },
    { customer: 'Lee', items: [line('P-A', 0)] },
    { customer: 'Lee', items: [line('P-A', 1.5)] },
    { customer: 'Lee', items: [line('P-A', '2')] },
  ];
  for (const body of invalid) {
    assert.equal((await request('/api/orders', body)).status, 400);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
