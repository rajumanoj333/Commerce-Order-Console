const { seedState } = require('./seed');
const { OrderService, ApiError } = require('./service');

const pathname = 'stockroom/orders.json';
const privateRead = { access: 'private', useCache: false };
const privateWrite = { access: 'private', addRandomSuffix: false, contentType: 'application/json' };

async function withBlobState(sdk, operation) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let current = await sdk.get(pathname, privateRead);
    if (!current) {
      // Install only the seed here. Concurrent first writes must never replace orders.
      try {
        await sdk.put(pathname, JSON.stringify(seedState()), { ...privateWrite, allowOverwrite: false });
      } catch (error) {
        current = await sdk.get(pathname, privateRead);
        if (!current) throw error;
      }
      if (!current) current = await sdk.get(pathname, privateRead);
    }
    if (!current?.stream || !current.blob.etag) throw new Error('Cannot read versioned order state');
    const state = await new Response(current.stream).json();
    let updated;
    const service = new OrderService({
      exists: () => true,
      load: () => state,
      save: (draft) => { updated = draft; },
    });
    const result = operation(service);
    if (!updated) return result;
    try {
      await sdk.put(pathname, JSON.stringify(updated), {
        ...privateWrite, allowOverwrite: true, ifMatch: current.blob.etag,
      });
      return result;
    } catch (error) {
      if (!(error instanceof sdk.BlobPreconditionFailedError)) throw error;
      // Reload and recheck quantities and transitions against the winning commit.
    }
  }
  throw new ApiError(409, 'Another staff member updated orders. Refresh and try again.');
}

module.exports = { withBlobState };
