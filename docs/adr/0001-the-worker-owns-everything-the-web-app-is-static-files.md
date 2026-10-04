# The worker owns everything; the web app is static files

The worker holds the context folder, the sessions, every provider and the owner's login, and is the only server. The web
app is a single-page app (Vite, React, TanStack Router) built to static files that call the worker's API on the same
origin. Sessions run for minutes and outlive the browser tab, which needs a long-running process; that process is the
worker, so a second server in the web layer would only relay.

Static files also decide where the web app can live. At first the worker serves them itself, behind the owner's
reverse proxy. Later the reverse proxy on an always-on box (a NAS) serves them directly and forwards `/api` to the
worker, with no extra process on that box. The page then still loads when the worker machine is off, and can say so.

## Considered options

- **Next.js, as a server in front of the worker.** Rejected: server rendering adds little to a logged-in app made of
  live sessions, and it puts a Node process on the always-on box.
- **TanStack Start.** Rejected for the same reason: its value is server rendering and server functions, and the worker
  is already the server. Start is built on TanStack Router, so moving to it later stays possible.
- **One process for both, split later.** Rejected: the always-on box is a planned step, and splitting later is a
  rewrite of every data call.

## Consequences

- Nothing works while the worker is off except a page saying so. Models are unavailable then anyway.
- Login is the worker's job (ADR 0002), so there is no shared secret between two servers.
