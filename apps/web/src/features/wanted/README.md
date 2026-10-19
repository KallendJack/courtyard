# wanted

A planning workspace's wanted list (#245): a general block any workspace with something wanted shows. The worker's
side is [`wanted/`](../../../../worker/src/features/wanted/README.md).

**Example:** the Things tab of Mountain biking shows "Wanted · 3": Lights at ★ £55 with Tredz ↗, Flat pedal shoes,
and the Chain with Find picks. You tap Lights and see its three picks, each with why, its price, how fresh it is and
its shop's one button.

- **Uses:** `components/layout/kept.tsx` (kept fresh the shared way, every 3 seconds while picks are being found or
  prices checked), `components/buttons/` (the shop's `WebButton`).
- **Used by:** `features/planning-home/` (the Things tab), and Home's wanted list view once #481 draws Home.

## Screens

- **The list** (`wanted-list.tsx`; Paper, "Tablet · Wanted: one item's three picks" and "Cover · Wanted: one item's
  three picks"): each Thing's number, name, status ("To get", "Replace") and, only inside that line, a sale ("in the
  sale, usually £72"); its ★ pick's price and its shop's one button, or Find picks. Above them "★ picks so far" and
  how fresh the prices are; while they're being checked they show faintly, "checking…".
- **A Thing's picks:** tapping it shows its three, ★ Best value first and filled, each with why, its price, how fresh
  it is and its shop. On the cover screen they take the list's place, with the way back above them.

## How it works

- Its calls are in `api.ts`, off the first load. Nothing nags: there's no notification or badge for a price.
- Add to wanted from an answer is the `product` rich block (`components/rich-blocks/product.tsx`), and Blocked shops
  is a sheet from the workspace's ⋯ (`components/sheets/blocked-shops-sheet.tsx`).
