# Stockroom

Stockroom is a browser console for taking phone orders and tracking fulfilment. Try the [public demo](https://commerce-order-console.vercel.app/) or watch the [30-second video walkthrough](https://commerce-order-console.vercel.app/stockroom-demo.mp4).

The public demo uses a synthetic catalogue and a shared order list. Use fictional customer names. Hosted orders persist in a private Vercel Blob store. Each change checks the stored version and retries against fresh stock if another request wins the write. Local mode uses Node.js built-ins and saves orders on your machine.

## Run on this computer

From the project directory, with Node.js 20 or later installed:

```sh
npm run seed
npm start
```

Open **http://127.0.0.1:3000**. Leave the terminal running while using the desk and press Ctrl+C to stop it. Startup also initializes the store automatically. Running the seed command again preserves your orders and current stock.

The server listens on the IPv4 loopback interface. The default Windows data file is `%LOCALAPPDATA%\Stockroom\orders.json`. On Linux and macOS the default is `~/.local/share/stockroom/orders.json`. On first use, an existing workspace store at `data/db.json` is carried forward. The original file is retained. Future saves use the local application data file. You may copy the file while the server is stopped to make a backup.

To try a fresh catalogue separately on Windows, run these commands in another PowerShell terminal:

```powershell
$env:DATA_FILE = Join-Path $env:LOCALAPPDATA 'Stockroom/demo-orders.json'
$env:PORT = '3100'
npm start
```

Open http://127.0.0.1:3100. Each instance needs its own file. Choose an unused local filename for a fresh run.

## Two-minute walkthrough

1. On **Order desk**, search for **Ceramic Mug** and add two. Clear the search and add one **Canvas Tote Bag**. The order total is **$31.99**. The **Travel Flask** shows zero stock and cannot be added.
2. Enter a customer name and choose **Place order**. Keep the assigned reference. In a fresh store, mug stock drops from five to three and tote stock drops from forty to thirty-nine.
3. Open **Orders**, search for the reference, and open the order. Check the quantities, line totals, customer, and **Placed** status.
4. Mark it **Packed**. Filter the order list to **Packed** to see orders ready to ship. Choose **Cancel order** to return both products to stock. The cancelled order retains its history.
5. Place another order and move it through **Packed** to **Shipped**. Restart the server using the same file. Search for the reference again to check the saved status.

[View the order desk](docs/order-desk.png) · [View a packed order](docs/packed-order.png)

## Verify

```sh
npm test
```

Run `npm ci` before `npm test` to install the hosted storage SDK. Tests run with temporary stores and a simulated Blob store. They cover multi-item placement, totals, the mixed-stock rollback example, stock restoration on cancellation, repeated cancellation, forbidden transitions, reference search, filtering, input validation, restart persistence, and concurrent requests.

## How consistency works

The browser submits product IDs and quantities. The server calculates prices from its catalogue, combines duplicate product lines, and validates the entire order. A single in-memory transaction computes the order and stock changes together. The server writes and flushes the complete state to a temporary file, renames it into place, and then adopts that state in memory. All writes run synchronously in one Node process. Run one server process per data file.

| Current status | Allowed next statuses |
| --- | --- |
| Placed | Packed, Cancelled |
| Packed | Shipped, Cancelled |
| Shipped | None |
| Cancelled | None |

Cancellation restores stock in the same write that records the status and its timestamp. A second cancellation returns HTTP 409.

## Local API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/products | Current catalogue and stock |
| GET | /api/orders?q=ORD&status=Packed | Search references and filter by status |
| GET | /api/orders/:ref | Order, line items, and history |
| GET | /api/transitions | Allowed next statuses |
| POST | /api/orders | Place an order |
| POST | /api/orders/:ref/status | Apply a status change |

Example order body:

```json
{"customer":"Alex","items":[{"productId":"P-A","quantity":2},{"productId":"P-B","quantity":1}]}
```

With the seed catalogue this request returns HTTP 409 because P-B has zero stock. The server leaves all product quantities and the order list unchanged. To place a successful order, use only the P-A line. To pack it, send `{"status":"Packed"}` to its status endpoint.

## Source map

- `public/` contains the browser interface and six local product photographs.
- `src/server.js` serves the UI and API. `src/service.js` enforces placement and fulfilment rules.
- `src/store.js` and `src/seed.js` handle persistence and catalogue initialization.
- `test/orders.test.js` contains the automated checks.
- [design.md](design.md) documents the interface and interaction decisions.
