# One owner, a private network, and HTTPS through the owner's reverse proxy

A Courtyard can change code on the machine it runs on, so it has exactly one owner, created on first run with no
default password, and it is never exposed to the public internet. The owner reaches it at home and away through a mesh
VPN such as Tailscale, which Courtyard documents but does not bundle.

It is served over HTTPS from the start, through a reverse proxy the owner already runs, with a certificate the owner's
devices trust. Installing the web app on a phone's home screen and receiving push notifications both require a secure
origin, so HTTPS is a requirement of the product, not a hardening step.

## Considered options

- **Plain HTTP on the private network.** Rejected: no installable app and no notifications.
- **A shared login for friends.** Rejected: someone else who wants a Courtyard runs their own, with their own logins.

## Consequences

- The worker machine needs a fixed address on the network so the proxy can reach it.
- The README documents the proxy and the VPN as prerequisites, with the owner's setup as one example.
