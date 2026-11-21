const test = require('node:test');
const assert = require('node:assert/strict');
const { withBlobState } = require('../src/blob-store');

function privateBlob() {
  let value;
  let version = 0;
  class BlobPreconditionFailedError extends Error {}
  return {
    BlobPreconditionFailedError,
    async get(path, options) {
      assert.equal(path, 'stockroom/orders.json');
      assert.deepEqual(options, { access: 'private', useCache: false });
      if (!version) return null;
      return { blob: { etag: String(version) }, stream: new Response(value).body };
    },
    async put(path, json, options) {
      assert.equal(path, 'stockroom/orders.json');
      assert.equal(options.access, 'private');
      assert.equal(options.addRandomSuffix, false);
      if (!options.allowOverwrite && version) throw new Error('Already exists');
      if (options.allowOverwrite && options.ifMatch !== String(version)) throw new BlobPreconditionFailedError();
      value = json;
      version++;
    },
  };
}

test('hosted requests competing for the same stock recheck against the winning version', async () => {
  const sdk = privateBlob();
  const place = () => withBlobState(sdk, svc =>
    svc.placeOrder({ customer: 'Demo customer', items: [{ productId: 'P-A', quantity: 3 }] }));
  const outcomes = await Promise.allSettled([place(), place()]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(o => o.status === 'rejected').reason.status, 409);
  const orders = await withBlobState(sdk, svc => svc.listOrders());
  assert.equal(orders.length, 1);
  const currentStock = () => withBlobState(sdk, svc => svc.listProducts().find(p => p.id === 'P-A').stock);
  assert.equal(await currentStock(), 2);
  const cancel = () => withBlobState(sdk, svc => svc.transition(orders[0].ref, 'Cancelled'));
  const cancellations = await Promise.allSettled([cancel(), cancel()]);
  assert.equal(cancellations.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(cancellations.find(o => o.status === 'rejected').reason.status, 409);
  assert.equal(await currentStock(), 5);
});
