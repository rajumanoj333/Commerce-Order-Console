const TRANSITIONS = {
  Placed: ['Packed', 'Cancelled'],
  Packed: ['Shipped', 'Cancelled'],
  Shipped: [],
  Cancelled: [],
};
const STATUSES = Object.keys(TRANSITIONS);
const MAX_QTY = 1000;

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const money = (n) => Math.round(n * 100) / 100;

class OrderService {
  constructor(store, seedFn) {
    this.store = store;
    if (!store.exists()) store.save(seedFn());
    this.state = store.load();
  }

  listProducts() {
    return this.state.products;
  }

  listOrders({ q, status } = {}) {
    if (status && !STATUSES.includes(status)) throw new ApiError(400, `Unknown status "${status}"`);
    const needle = (q || '').trim().toLowerCase();
    return this.state.orders
      .filter((o) => (!status || o.status === status) && (!needle || o.ref.toLowerCase().includes(needle)))
      .slice()
      .reverse();
  }

  getOrder(ref) {
    const o = this.state.orders.find((x) => x.ref.toLowerCase() === String(ref).toLowerCase());
    if (!o) throw new ApiError(404, `Order ${ref} not found`);
    return o;
  }

  // All-or-nothing: work on a deep copy, persist, then swap in. Any failure
  // before the swap leaves memory and disk untouched.
  _commit(mutator) {
    const draft = structuredClone(this.state);
    const result = mutator(draft);
    this.store.save(draft);
    this.state = draft;
    return result;
  }

  placeOrder({ customer, items } = {}) {
    const name = typeof customer === 'string' ? customer.trim() : '';
    if (!name) throw new ApiError(400, 'Customer name is required');
    if (name.length > 100) throw new ApiError(400, 'Customer name is too long');
    if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'Order needs at least one item');

    const wanted = new Map();
    for (const it of items) {
      const qty = it && it.quantity;
      if (!it || typeof it.productId !== 'string' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
        throw new ApiError(400, `Each item needs a productId and an integer quantity from 1 to ${MAX_QTY}`);
      }
      wanted.set(it.productId, (wanted.get(it.productId) || 0) + qty);
    }

    return this._commit((draft) => {
      const problems = [];
      const lines = [];
      for (const [productId, quantity] of wanted) {
        const p = draft.products.find((x) => x.id === productId);
        if (!p) {
          problems.push({ productId, reason: 'Unknown product' });
        } else if (p.stock < quantity) {
          problems.push({ productId, name: p.name, requested: quantity, available: p.stock, reason: 'Insufficient stock' });
        } else {
          lines.push({ productId, name: p.name, unitPrice: p.price, quantity, lineTotal: money(p.price * quantity) });
        }
      }
      if (problems.length) {
        throw new ApiError(409, 'Order rejected: some items are unavailable. No stock was changed.', problems);
      }
      for (const l of lines) draft.products.find((x) => x.id === l.productId).stock -= l.quantity;
      const now = new Date().toISOString();
      const order = {
        ref: 'ORD-' + String(draft.nextOrderNumber++).padStart(4, '0'),
        customer: name,
        items: lines,
        total: money(lines.reduce((s, l) => s + l.lineTotal, 0)),
        status: 'Placed',
        createdAt: now,
        history: [{ status: 'Placed', at: now }],
      };
      draft.orders.push(order);
      return order;
    });
  }

  transition(ref, to) {
    if (!STATUSES.includes(to)) throw new ApiError(400, `Unknown status "${to}"`);
    return this._commit((draft) => {
      const order = draft.orders.find((x) => x.ref.toLowerCase() === String(ref).toLowerCase());
      if (!order) throw new ApiError(404, `Order ${ref} not found`);
      if (!TRANSITIONS[order.status].includes(to)) {
        throw new ApiError(409, `Invalid transition: ${order.status} -> ${to}`);
      }
      // Restore happens only here, and only from Placed/Packed, which can be
      // left only once. A repeat cancel fails the check above.
      if (to === 'Cancelled') {
        for (const l of order.items) draft.products.find((p) => p.id === l.productId).stock += l.quantity;
      }
      order.status = to;
      order.history.push({ status: to, at: new Date().toISOString() });
      return order;
    });
  }
}

module.exports = { OrderService, ApiError, TRANSITIONS };
