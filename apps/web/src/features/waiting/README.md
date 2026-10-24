# waiting

What waits on the owner, everywhere (#492), as the worker's
[`waiting/`](../../../../worker/src/features/waiting/README.md) decides it: the one store the Courtyard mark's gold
count, Home's Needs you and a session's Next pill all read, so they always agree.

**Example:** Build #285 asks to push its branch. The mark shows a gold 1 on every page, Home's Needs you says
"Approve · Build #285 · Courtyard", and the session you're reading shows "Next · Approve in Build #285".

- **Uses:** `GET /api/needs-you`, and `packages/ui/layout/kept.tsx` (kept for the tab's lifetime, fresh the shared
  way, faster while a turn runs anywhere).
- **Used by:** the frame (`components/frame/handheld-frame.tsx`, the mark's count), `features/home/needs-you.tsx`
  (Home's block) and the session page (the Next pill).

## Screens

- **The Next pill** (`next-pill.tsx`): in a session's chip row (or a row of its own when it has no branch), gold,
  the first thing waiting anywhere else, "Next · Reply in Winter tyres", one tap opening it; only while something
  else waits.

## How it works

- `api.ts`: `useNeedsYou`, asked again on each move to another page, and the words a row and the pill say
  (`NEED_WORDS`, `needTitle`) and where a tap goes (`needLink`: the session, or its pull request's review).
- No styles of its own beyond the pill's, so the frame can ask on every page.
