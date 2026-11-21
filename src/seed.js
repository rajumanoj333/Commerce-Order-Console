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
  new JsonStore(file).save(seedState());
}

module.exports = { seedState, seed };

if (require.main === module) {
  const file = process.env.DATA_FILE || require('node:path').join(__dirname, '..', 'data', 'db.json');
  seed(file);
  console.log('Seeded', file);
}
