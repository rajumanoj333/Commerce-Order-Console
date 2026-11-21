const { JsonStore } = require('./store');

const SEED_PRODUCTS = [
  { id: 'P-A', name: 'Ceramic Mug', price: 8.5, stock: 5 },
  { id: 'P-B', name: 'Travel Flask', price: 22.0, stock: 0 },
  { id: 'P-C', name: 'Canvas Tote Bag', price: 14.99, stock: 40 },
  { id: 'P-D', name: 'Notebook (A5)', price: 4.25, stock: 120 },
  { id: 'P-E', name: 'Desk Lamp', price: 35.0, stock: 8 },
  { id: 'P-F', name: 'Wireless Mouse', price: 19.9, stock: 15 },
];

function seedState() {
  return { nextOrderNumber: 1, products: SEED_PRODUCTS.map((p) => ({ ...p })), orders: [] };
}

function seed(file) {
  const store = new JsonStore(file);
  if (store.exists()) return false;
  store.save(seedState());
  return true;
}

module.exports = { seedState, seed };

if (require.main === module) {
  const file = require('./store').prepareDataFile();
  const created = seed(file);
  console.log(created ? 'Seeded' : 'Found existing store at', file);
}
