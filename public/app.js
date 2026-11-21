'use strict';

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const state = { products: [], orders: [], transitions: {}, cart: new Map(), selected: null, busy: false, connected: false };
let cartVisible = false;
const paths = {
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z M3 7.5l9 4.5 9-4.5 M12 12v9 M7.5 5.25l9 4.5',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list: 'M7 3h12v18H5V3z M8 8h8 M8 12h8 M8 16h5',
  receipt: 'M5 3l2 1.5L9 3l3 1.5L15 3l2 1.5L19 3v18l-3-1.5-4 1.5-4-1.5L5 21z M8 8h8 M8 12h8 M8 16h5',
  search: 'M16 16l5 5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 1 1 15 0z',
  sliders: 'M3 7h8m4 0h6M3 17h3m4 0h11 M11 4v6 M8 14v6',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21v-2a7 6 0 0 1 7-6h2a7 6 0 0 1 7 6v2',
  bag: 'M5 8h14l1 13H4z M8 10V7a4 4 0 0 1 8 0v3',
  check: 'm4 12 5 5L20 6', plus: 'M5 12h14 M12 5v14', minus: 'M5 12h14',
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'
};

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({
    class: 'ico', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
  })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
document.querySelectorAll('[data-icon]').forEach((node) => node.append(icon(node.dataset.icon)));

function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function button(label, className, callback, glyph, iconOnly = false) {
  const node = el('button', className);
  node.type = 'button';
  if (glyph) node.append(icon(glyph));
  if (iconOnly) node.setAttribute('aria-label', label);
  else node.append(label);
  node.addEventListener('click', callback);
  return node;
}

function emptyPanel(kind, glyph, title, help) {
  return el('div', kind, el('span', 'empty-icon', icon(glyph)), el('strong', '', title), el('p', '', help));
}

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch('/api' + path, {
      method, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Cannot connect to the local console. Check that the server is running.');
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.details = data.details;
    throw error;
  }
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = isError ? 'err' : '';
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function renderCatalogue() {
  const search = $('#product-search').value.trim().toLowerCase();
  const filter = $('#stock-filter').value;
  const products = state.products.filter((p) =>
    (p.name + ' ' + p.id).toLowerCase().includes(search) &&
    (!filter || (filter === 'out' ? p.stock === 0 : p.stock > 0))
  );
  $('#product-count').textContent = products.length;
  const cards = products.map((p) => {
    const image = el('img', 'product-img');
    image.src = '/images/' + encodeURIComponent(p.id) + '.jpg';
    image.alt = '';
    const status = p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : '';
    const add = button('Add', 'add', () => changeCart(p.id, 1), 'plus');
    add.setAttribute('aria-label', 'Add ' + p.name + ' to order');
    add.dataset.key = 'add-' + p.id;
    add.disabled = state.busy || (state.cart.get(p.id) || 0) >= p.stock;
    return el('article', 'product', image, el('div', 'product-body',
      el('div', 'product-meta', 'SKU ' + p.id),
      el('h3', '', p.name), el('span', 'stock ' + status, p.stock ? p.stock + ' in stock' : 'Out of stock'),
      el('div', 'product-foot', el('span', 'price', money(p.price)), add)));
  });
  $('#products').replaceChildren(...(cards.length ? cards : [emptyPanel('empty-results', 'search', 'No matching products', 'Try another product name or stock filter.')]));
}

function showOrderError(error) {
  const box = $('#order-error');
  box.replaceChildren();
  box.hidden = !error;
  if (!error) return;
  box.append(error.message);
  if (Array.isArray(error.details)) {
    box.append(el('ul', '', ...error.details.map((entry) => el('li', '', entry.name ?
      entry.name + ' · ' + entry.requested + ' requested, ' + entry.available + ' available' :
      entry.productId + ' · ' + entry.reason))));
  }
}

function changeCart(id, amount) {
  if (state.busy) return;
  const product = state.products.find((p) => p.id === id);
  const previous = state.cart.get(id) || 0;
  const quantity = previous + amount;
  if (quantity > product.stock && quantity > previous) return;
  const focusKey = document.activeElement.dataset.key;
  if (quantity <= 0) state.cart.delete(id);
  else state.cart.set(id, quantity);
  showOrderError(null);
  renderCatalogue();
  renderCart();
  if (focusKey) document.querySelector('[data-key="' + CSS.escape(focusKey) + '"]:not(:disabled)')?.focus({ preventScroll: true });
}

function renderCart() {
  const lines = [];
  let cents = 0;
  let units = 0;
  let invalid = false;
  for (const [id, qty] of state.cart) {
    const p = state.products.find((item) => item.id === id);
    if (!p) continue;
    const lineCents = Math.round(p.price * 100) * qty;
    cents += lineCents;
    units += qty;
    const minus = button('Decrease ' + p.name, '', () => changeCart(id, -1), 'minus', true);
    const plus = button('Increase ' + p.name, '', () => changeCart(id, 1), 'plus', true);
    const remove = button('Remove ' + p.name, 'icon-btn', () => changeCart(id, -qty), 'trash', true);
    minus.dataset.key = 'decrease-' + id;
    plus.dataset.key = 'increase-' + id;
    remove.dataset.key = 'remove-' + id;
    plus.disabled = state.busy || qty >= p.stock;
    minus.disabled = remove.disabled = state.busy;
    const description = el('div', '', el('strong', '', p.name), el('div', 'qty', minus, el('span', '', String(qty)), plus));
    if (qty > p.stock) {
      invalid = true;
      description.append(el('span', 'stock out', 'Only ' + p.stock + ' available'));
    }
    lines.push(el('div', 'cart-line', description, el('div', 'line-end', el('strong', '', money(lineCents / 100)), remove)));
  }
  $('#cart-count').textContent = units + (units === 1 ? ' item' : ' items');
  $('#mobile-cart span').textContent = 'Review order · ' + units + (units === 1 ? ' item' : ' items');
  $('#mobile-cart').hidden = !units || cartVisible || location.hash === '#orders';
  $('#cart-total').textContent = money(cents / 100);
  $('#place-order').disabled = !units || invalid || state.busy || !state.connected;
  $('#customer').disabled = state.busy;
  $('#cart').replaceChildren(lines.length ? el('div', 'cart-lines', ...lines) :
    emptyPanel('empty-cart', 'bag', 'Your order is empty', 'Add products from the catalogue to get started.'));
}

function renderOrders() {
  const query = $('#search').value.trim().toLowerCase();
  const status = $('#status').value;
  const orders = state.orders.filter((o) => o.ref.toLowerCase().includes(query) && (!status || o.status === status));
  $('#order-count').textContent = orders.length;
  const rows = orders.map((o) => {
    const row = button('', 'order-row' + (state.selected?.ref === o.ref ? ' selected' : ''), () => selectOrder(o.ref));
    row.append(el('span', 'order-cell', el('strong', '', o.ref), el('span', 'muted', '', o.customer)),
      el('span', 'order-cell', el('strong', '', money(o.total)), el('span', 'status ' + o.status, o.status)));
    return row;
  });
  $('#order-list').replaceChildren(...(rows.length ? rows : [emptyPanel('empty-results', 'list',
    state.orders.length ? 'No matching orders' : 'No orders yet',
    state.orders.length ? 'Try another reference or status.' : 'Place your first order from the order desk.')]));
}

let detailRequest = 0;
async function selectOrder(ref) {
  const request = ++detailRequest;
  try {
    const order = await api('/orders/' + encodeURIComponent(ref));
    if (request !== detailRequest) return;
    state.selected = order;
    renderOrders();
    renderDetail();
    if (window.matchMedia('(max-width:680px)').matches) $('#detail').scrollIntoView({ block: 'center' });
  } catch (error) { toast(error.message, true); }
}

function renderDetail() {
  const order = state.selected;
  if (!order) {
    $('#detail').replaceChildren(emptyPanel('empty-detail', 'receipt', 'Select an order', 'Open an order to review its items and update fulfilment.'));
    return;
  }
  const actions = el('div', 'actions');
  for (const status of state.transitions[order.status] || []) {
    const cancel = status === 'Cancelled';
    const action = button(cancel ? 'Cancel order' : 'Mark as ' + status.toLowerCase(), cancel ? 'secondary danger' : 'primary', () => {
      if (!cancel) return move(order.ref, status);
      actions.replaceChildren(el('p', 'confirm-text', 'Cancel this order and return its items to stock?'),
        button('Confirm cancellation', 'secondary danger', () => move(order.ref, status)),
        button('Keep order', 'secondary', renderDetail));
      actions.querySelector('button').focus();
    });
    action.disabled = state.busy || !state.connected;
    actions.append(action);
  }
  const history = el('ul', 'history', ...order.history.map((entry) =>
    el('li', '', el('span', '', entry.status), el('time', '', new Date(entry.at).toLocaleString(undefined, { dateStyle:'short', timeStyle:'short' })))));
  $('#detail').replaceChildren(el('div', 'detail-body',
    el('div', 'ticket-headline', el('h3', '', order.ref), el('span', 'status ' + order.status, order.status)),
    el('div', 'detail-meta muted', order.customer),
    ...order.items.map((line) => el('div', 'detail-line', el('span', '', line.quantity + ' × ' + line.name), el('strong', '', money(line.lineTotal)))),
    el('div', 'total-line', el('span', '', 'Order total'), el('strong', '', money(order.total))),
    history, actions));
}

function setView() {
  const ordersView = location.hash === '#orders';
  $('#desk').hidden = ordersView;
  $('#orders').hidden = !ordersView;
  $('#mobile-cart').hidden = ordersView || cartVisible || !state.cart.size;
  for (const [link, active] of [[$('#desk-link'), !ordersView], [$('#orders-link'), ordersView]]) {
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const title = ordersView ? 'Orders' : 'Order desk';
  $('#page-title').textContent = title;
  $('#page-intro').textContent = ordersView ? 'Find an order and manage its fulfilment.' : 'Browse the catalogue and build a customer order.';
  document.title = title + ' | Stockroom';
}

let refreshRequest = 0;
async function refresh() {
  const request = ++refreshRequest;
  try {
    const [products, orders, transitions] = await Promise.all([api('/products'), api('/orders'), api('/transitions')]);
    if (request !== refreshRequest) return;
    Object.assign(state, { products, orders, transitions, connected: true });
    if (state.selected) state.selected = orders.find((order) => order.ref === state.selected.ref) || null;
    $('#load-error').hidden = true;
  } catch (error) {
    if (request !== refreshRequest) return;
    state.connected = false;
    const box = $('#load-error');
    box.replaceChildren(error.message + ' ', button('Retry', 'secondary', refresh));
    box.hidden = false;
  }
  $('#connection-label').textContent = state.connected ? 'System online' : 'Disconnected';
  $('#connection').classList.toggle('online', state.connected);
  renderCatalogue();
  renderCart();
  renderOrders();
  renderDetail();
}

async function move(ref, status) {
  if (state.busy) return;
  state.busy = true;
  renderDetail();
  try {
    const updated = await api('/orders/' + encodeURIComponent(ref) + '/status', 'POST', { status });
    if (state.selected?.ref === ref) state.selected = updated;
    toast(ref + ' is now ' + status.toLowerCase() + '.');
  } catch (error) { toast(error.message, true); }
  finally {
    state.busy = false;
    await refresh();
  }
}

$('#order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy || !state.cart.size) return;
  const customer = $('#customer').value.trim();
  if (!customer) {
    showOrderError(new Error('Enter a customer name before placing this order.'));
    $('#customer').focus();
    return;
  }
  state.busy = true;
  showOrderError(null);
  renderCart();
  renderCatalogue();
  try {
    const items = [...state.cart].map(([productId, quantity]) => ({ productId, quantity }));
    const order = await api('/orders', 'POST', { customer, items });
    state.cart.clear();
    $('#customer').value = '';
    $('#search').value = $('#status').value = '';
    state.selected = order;
    location.hash = 'orders';
    setView();
    toast('Order ' + order.ref + ' placed.');
  } catch (error) { showOrderError(error); }
  finally {
    state.busy = false;
    await refresh();
  }
});

$('#search').addEventListener('input', renderOrders);
$('#mobile-cart').addEventListener('click', () => {
  $('#order-form').scrollIntoView({ block: 'center' });
  $('#customer').focus({ preventScroll: true });
});
new IntersectionObserver(([entry]) => {
  cartVisible = entry.isIntersecting;
  $('#mobile-cart').hidden = cartVisible || !state.cart.size || location.hash === '#orders';
}).observe($('#order-form'));
$('#status').addEventListener('change', renderOrders);
$('#product-search').addEventListener('input', renderCatalogue);
$('#stock-filter').addEventListener('change', renderCatalogue);
window.addEventListener('hashchange', () => {
  setView();
  if (!state.busy) refresh();
  window.scrollTo(0,0);
});
window.addEventListener('focus', () => { if (!state.busy) refresh(); });
setView();
refresh();
