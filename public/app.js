const $ = (s) => document.querySelector(s);
const money = (n) => '$' + Number(n).toFixed(2);
const state = { products: [], transitions: {}, cart: new Map(), selected: null };

// Build elements with textContent only, so user-entered text is never parsed as HTML.
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e[k] = v;
  }
  for (const k of kids) e.append(k);
  return e;
}

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) { const err = new Error(data.error); err.details = data.details; throw err; }
  return data;
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = isErr ? 'err' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function renderCatalogue() {
  const tb = $('#catalogue tbody'); tb.replaceChildren();
  for (const p of state.products) {
    const cls = p.stock === 0 ? 'oos' : p.stock <= 5 ? 'low' : '';
    const label = p.stock === 0 ? 'Out of stock' : String(p.stock);
    const btn = el('button', { type: 'button', textContent: 'Add', disabled: p.stock === 0, onclick: () => addToCart(p.id) });
    tb.append(el('tr', {}, el('td', { textContent: p.name }), el('td', { textContent: money(p.price) }), el('td', { class: cls, textContent: label }), el('td', {}, btn)));
  }
}

function addToCart(id) {
  const p = state.products.find((x) => x.id === id);
  const cur = state.cart.get(id) || 0;
  if (cur + 1 > p.stock) return toast(`Only ${p.stock} of ${p.name} in stock`, true);
  state.cart.set(id, cur + 1);
  renderCart();
}

function renderCart() {
  const tb = $('#cart tbody'); tb.replaceChildren();
  let total = 0;
  for (const [id, qty] of state.cart) {
    const p = state.products.find((x) => x.id === id);
    total += p.price * qty;
    const input = el('input', { type: 'number', min: 1, max: p.stock, value: qty, 'aria-label': `Quantity for ${p.name}` });
    input.addEventListener('change', () => {
      const n = parseInt(input.value, 10);
      if (!Number.isInteger(n) || n < 1) state.cart.delete(id); else state.cart.set(id, n);
      renderCart();
    });
    const rm = el('button', { type: 'button', textContent: 'Remove', onclick: () => { state.cart.delete(id); renderCart(); } });
    tb.append(el('tr', {}, el('td', { textContent: p.name }), el('td', {}, input), el('td', { textContent: money(p.price * qty) }), el('td', {}, rm)));
  }
  $('#cart-empty').hidden = state.cart.size > 0;
  $('#cart-total').textContent = money(total);
}

function showOrderError(err) {
  const box = $('#order-error'); box.replaceChildren();
  if (!err) { box.hidden = true; return; }
  box.append(err.message);
  if (Array.isArray(err.details)) {
    const ul = el('ul');
    for (const d of err.details) {
      ul.append(el('li', { textContent: d.name ? `${d.name}: requested ${d.requested}, available ${d.available}` : `${d.productId}: ${d.reason}` }));
    }
    box.append(ul);
  }
  box.hidden = false;
}

$('#order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showOrderError(null);
  const items = [...state.cart].map(([productId, quantity]) => ({ productId, quantity }));
  if (!items.length) return showOrderError(new Error('Add at least one product'));
  try {
    const o = await api('/orders', 'POST', { customer: $('#customer').value, items });
    state.cart.clear(); $('#customer').value = '';
    toast(`Order ${o.ref} placed`);
    state.selected = o.ref;
  } catch (err) {
    showOrderError(err);
  }
  await refresh();
});

function renderOrders(orders) {
  const tb = $('#orders tbody'); tb.replaceChildren();
  if (!orders.length) tb.append(el('tr', {}, el('td', { colSpan: 4, class: 'muted', textContent: 'No orders match.' })));
  for (const o of orders) {
    const tr = el('tr', { class: 'row' + (o.ref === state.selected ? ' sel' : ''), tabIndex: 0, onclick: () => select(o.ref) },
      el('td', { textContent: o.ref }), el('td', { textContent: o.customer }), el('td', { textContent: money(o.total) }),
      el('td', {}, el('span', { class: 'badge ' + o.status, textContent: o.status })));
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') select(o.ref); });
    tb.append(tr);
  }
}

async function select(ref) { state.selected = ref; await refresh(); }

async function renderDetail() {
  const box = $('#detail'); box.replaceChildren();
  if (!state.selected) return box.append(el('p', { class: 'muted', textContent: 'Select an order to see details.' }));
  let o;
  try { o = await api('/orders/' + encodeURIComponent(state.selected)); } catch (e) { return box.append(el('p', { class: 'muted', textContent: e.message })); }
  const rows = o.items.map((l) => el('tr', {}, el('td', { textContent: l.name }), el('td', { textContent: l.quantity }), el('td', { textContent: money(l.lineTotal) })));
  const actions = el('div', { class: 'actions' });
  for (const next of state.transitions[o.status]) {
    actions.append(el('button', { type: 'button', class: next === 'Cancelled' ? 'danger' : 'primary', textContent: next === 'Cancelled' ? 'Cancel order' : 'Mark ' + next, onclick: () => move(o.ref, next) }));
  }
  box.append(
    el('h3', { textContent: o.ref }),
    el('p', {}, el('span', { class: 'badge ' + o.status, textContent: o.status }), ` ${o.customer}`),
    el('table', {}, el('thead', {}, el('tr', {}, el('th', { textContent: 'Item' }), el('th', { textContent: 'Qty' }), el('th', { textContent: 'Line' }))), el('tbody', {}, ...rows)),
    el('p', { class: 'total' }, 'Total: ', el('strong', { textContent: money(o.total) })),
    el('p', { class: 'muted', textContent: 'History: ' + o.history.map((h) => `${h.status} ${new Date(h.at).toLocaleString()}`).join(' > ') }),
    actions
  );
}

async function move(ref, status) {
  try { await api(`/orders/${encodeURIComponent(ref)}/status`, 'POST', { status }); toast(`${ref} is now ${status}`); }
  catch (e) { toast(e.message, true); }
  await refresh();
}

async function refresh() {
  const q = $('#search').value, status = $('#status').value;
  const qs = new URLSearchParams({ ...(q && { q }), ...(status && { status }) });
  const [products, orders] = await Promise.all([api('/products'), api('/orders?' + qs)]);
  state.products = products;
  for (const [id, qty] of state.cart) {
    const p = products.find((x) => x.id === id);
    if (!p || p.stock === 0) state.cart.delete(id); else if (qty > p.stock) state.cart.set(id, p.stock);
  }
  renderCatalogue(); renderCart(); renderOrders(orders); await renderDetail();
}

$('#search').addEventListener('input', refresh);
$('#status').addEventListener('change', refresh);
(async () => { state.transitions = await api('/transitions'); await refresh(); })().catch((e) => toast(e.message, true));
