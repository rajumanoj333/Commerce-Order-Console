# Stockroom interface design

## Staff workflow

A phone-order operator needs to answer three questions quickly: What can we sell? What has the customer requested? Which orders can ship? The Order desk keeps product availability and the current ticket together. The Orders view brings search, status filtering, order details, and fulfilment actions into one workspace.

## Visual system

Use deep pine green for the workspace identity and primary actions, a light neutral workspace, and dark text for prices and quantities. Give each product a distinct studio photograph with a muted background. Use consistent image crops so shape and material distinguish the six items. Keep names and stock counts visible alongside the photographs.

A compact navigation bar identifies the active workspace. A parcel illustration marks the order desk. Product cards and the current order use separate headings, with a prominent total directly above the placement action. Narrow layouts stack the ticket and catalogue and allow controls to wrap.

## Interaction decisions

- Show exact available quantities and label unavailable products. Disable adding an unavailable product.
- Keep quantity controls, removal, and line totals together. Recalculate the draft total immediately as staff change quantities.
- Place orders against authoritative server stock. Surface a rejection in the ordering workflow so staff can correct the ticket.
- Show reference, customer, purchased items, total, current status, and history together in order details.
- Display only actions allowed for the current status. Validate every transition again on the server.
- Use visible text for stock and status, labelled fields for search and filtering, and keyboard-operable controls.

## Local assets and operation

The browser loads the application, API, and product images from the same loopback server. No remote font, authentication provider, payment integration, or separate database service is required.
