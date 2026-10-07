# Overflow goes to Codex on a ChatGPT plan, not to local models or Gemini

Changed by ADR 0015: Codex runs through its app-server, not the Codex SDK, in its own Codex home and without a
shell.

When Claude hits a usage limit, the owner continues the session on another provider. That provider is Codex, through
the Codex SDK with a ChatGPT plan login: a second frontier model, on a flat subscription, that can code, and that
OpenAI supports driving headlessly. It is added after the core works, when the owner subscribes.

## Considered options

- **Local models on the worker's GPU.** Rejected for the main path: an 8 GB card runs 7-12B models, well below the
  frontier models the owner switches to today. The provider seam keeps an OpenAI-compatible adapter possible later.
- **Gemini on a Google subscription.** Rejected: Google treats using the Gemini CLI's login from third-party software
  as a policy violation. Gemini by API key is per-token, or a small free tier.
- **A bigger Claude plan instead.** Not rejected, just not a design question: it reduces how often overflow happens,
  and changes nothing in the code.
- **Per-token through a router (OpenRouter).** Kept as a possible later provider with a spending cap.

## Consequences

- Two adapters behind one provider seam, each the only place that knows its provider's login and billing.
- Overflow must carry the context file and the conversation so far, because the new model has neither.
