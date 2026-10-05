# Courtyard

A self-hosted place to plan projects and write code with AI models, where every area of your life keeps its own
context, so you never re-explain your space, your constraints or your stack.

- **Workspaces are folders.** One per project or area, each with a short `CONTEXT.md` split into facts, plans and ideas.
- **Context stays true.** Models suggest changes when you ask; only the ones you tick get in, and each is a git commit.
- **Your subscriptions, not per-token billing.** Claude through your own Claude Code login, with Codex on a ChatGPT plan
  for when Claude's usage limit hits.
- **Real coding.** In a code workspace, Claude works on its own branch while you're away, asks before anything risky,
  and you review and merge from your phone.
- **Yours alone.** One owner, plain files, no database, private network only.

Status: being built. What is being built is in [`docs/spec.md`](docs/spec.md).

## Reaching it: HTTPS and a VPN

Courtyard is for a private network only, and it needs HTTPS: phones only install a web app, or
show its notifications, from a secure address. It doesn't bundle either piece; you bring two
things you may already run:

- **A reverse proxy with HTTPS**, whose certificate your devices trust. It answers at a name such
  as `https://<courtyard-name>` and forwards to the worker at `http://<worker-address>:8787`
  (`COURTYARD_PORT`). It must say which scheme the browser used, in `X-Forwarded-Proto`, and
  pass streamed answers straight through without buffering them. Most proxies do both by default;
  nginx needs `proxy_buffering off`.
- **A mesh VPN**, such as Tailscale, so the same name works away from home. Courtyard is never
  exposed to the public internet.

On the worker machine:

1. **Give it a fixed address**, so the proxy can always find it: reserve one for it on your router
   (often called a DHCP reservation).
2. **Let only the proxy in.** Allow inbound TCP on the worker's port from the proxy's address,
   and nothing else, so nobody on your network can reach the worker without HTTPS.

### One example: Caddy and Tailscale on a home server

A NAS at `192.0.2.2` runs Caddy and Tailscale, and the worker runs on a PC at `192.0.2.10`.

- **Caddy**, with its own certificate authority, and its root certificate installed on each device:

  ```caddyfile
  courtyard.internal {
  	tls internal
  	reverse_proxy 192.0.2.10:8787
  }
  ```

- **DNS:** the network's DNS server (AdGuard Home, Pi-hole or the router) answers
  `courtyard.internal` with the NAS's address.
- **Tailscale** on the NAS advertises the home network as a subnet route, and a split-DNS entry
  sends `.internal` names to the home DNS server. Away from home, the phone reaches Caddy through
  the NAS and gets the same name, certificate and app.
- **On the PC (Windows)**, an inbound firewall rule for the worker's port, from the NAS only, in
  an administrator PowerShell:

  ```powershell
  New-NetFirewallRule -DisplayName "Courtyard worker" -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 192.0.2.2 -Action Allow
  ```

## Claude

Courtyard talks to Claude through Claude Code on the machine its worker runs on (the Agent SDK),
so it uses whatever that machine is signed in with:

- **Your Claude plan:** log in once with Claude Code on the worker machine (`claude`, then
  `/login`). Courtyard's usage counts against your plan's limits, like Claude Code's own.
- **Or an API key:** set `ANTHROPIC_API_KEY` in the worker's environment. That's billed per token.

Courtyard never reads, stores or logs either. Anthropic doesn't let apps offer a claude.ai login
to other people, so everyone who runs Courtyard signs in with their own. Set
`COURTYARD_CLAUDE_PROVIDER=0` to leave Claude out.

Each session sees only its own workspace's folder: none of the machine's Claude Code settings,
memory, skills or connectors, and in planning workspaces it can only read. What is being built is in [`docs/spec.md`](docs/spec.md), the vocabulary in
[`GLOSSARY.md`](GLOSSARY.md), and why it is built this way in [`docs/adr/`](docs/adr/).
