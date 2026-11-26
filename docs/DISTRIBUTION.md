# Distributor layer (Phase 9)

For a wholesaler/distributor that buys in bulk from manufacturers and sells in bulk to customers.

## Warehouse ownership
| Type | Meaning | Replenishment |
|---|---|---|
| `self` | stock we own | normal PO to the best supplier |
| `vendor` | consignment stock owned by a vendor | only that vendor can be ordered from; PO `order_type=consignment` (cost incurred when consumed) |
| `customer` | stock held for a customer | **no PO can be raised**; the shortage is flagged "notify customer" |
Enforced in `procurement.create_po` (so manual POs obey it too, HTTP 409), not only in the replenishment screen.

## Price breaks
* Buy side `supplier_price_breaks(supplier_product_id, min_qty, unit_price)`; PO lines are priced at the break for the ordered quantity.
* Sell side `sales_price_breaks(product_id, customer_id|NULL, min_qty, unit_price)`; a customer's own tiers override the list tiers.
* Rule: price = row with the highest `min_qty <= quantity`, else the base price. Tiers must not get dearer as quantity rises (validated).
* `GET /pricing/quote` returns sell price, best buy cost at that quantity, margin and the next break.

## Shortage -> PO (`/replenishment/shortages`, `/replenishment/create-pos`)
Needed quantity = existing reorder formula. If a higher supplier break is within 60 days of extra demand it is shown as a `break_option`;
it is applied automatically only when buying up to the break costs no more in total, or when `take_price_breaks=true`.

## Goods receipt
PO `sent` adds to `quantity_on_order`; `received` adds the unreceived quantity to `quantity_on_hand`, releases on-order and writes an
`inventory_movements` receipt row; cancelling a sent/partial PO releases the unreceived on-order quantity.

## Demo data
`python -m app.database.seed --distribution` (also part of a fresh seed): 6 customers, WH-WEST vendor-owned, WH-CENTRAL customer-owned,
supplier cost reset to 60-78% of list price, 2 supplier tiers per supplier product, list + contract sales tiers. **Synthetic.**

## Not built yet
Sales orders / customer invoicing, partial receipts (receipt is all-or-nothing), consignment consumption -> payable, per-customer stock
reservation, multi-currency/UOM conversions, multi-level approvals.
