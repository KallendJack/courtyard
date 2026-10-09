# Web search crosses the workspace boundary only to read

ADR 0003 keeps a model inside its workspace: its folder, its context file and nothing of the worker machine. Web
search (#108) is the first thing that reaches past that, because everyday questions (prices, stock, reviews, opening
times, what fits) need facts newer than the model. So a model in a planning workspace can search the web and read
pages, on these terms:

- **What may be fetched.** Claude gets Claude Code's `WebSearch` and `WebFetch`. The `confineTo` hook allows a fetch
  only for a page in that turn's search results or a link in the owner's messages, and refuses any other with a
  reason the model can act on. A model can't make up an address, so it can't put what it knows into one and send it
  to a site.
- **Codex searches on cached mode** (`web_search = "cached"`, set for its thread): results from OpenAI's index, with
  no live fetching, since Courtyard can't limit what Codex opens.
- **Results are information, never instructions.** A page can say anything, so `docs/ai-conduct.md` tells a model not
  to do what a page tells it to, and the boundary doesn't rest on that: a page can't widen what may be fetched, and
  reading is all a model can do on the web.
- **Nothing from context goes into a search or an address** beyond what the question needs. The fetch rule above
  makes that hold for addresses; for searches it's a rule in `docs/ai-conduct.md`, since a search's words are the
  model's.
- **Planning workspaces only, always on.** The model decides when to search. A code workspace, whose models will work
  on repositories, gets none until phase 4 decides what its models may reach.
- **Sources** are recorded as an event and listed under the answer, so the owner can check where facts came from.
  No site icons are loaded, so no site learns that an answer was shown.

## Considered options

- **Claude's `WebFetch` for any address.** Rejected: a model tricked by a page could put the owner's context into an
  address and send it away with a fetch.
- **Codex on live search.** Rejected: its fetching can't be limited the way Claude's hook limits it.
- **Search only when the owner asks,** with a button or a toggle. Rejected: the owner wanted it to just work, as in
  the Claude and ChatGPT apps; the eval checks it isn't overused.
- **Courtyard's own search tool,** through a search API. Rejected for now: another account and key to manage, when
  both providers come with search on the owner's plan.

## Consequences

- **A fetch can still leak through a search result's address,** if a search engine returned one carrying something
  from the query. The query's words are the model's, kept to what the question needs by `docs/ai-conduct.md`.
- **Codex can't read a page the owner pastes** unless its cached index has it; ai-conduct says "if you can".
- **Codex gives no list of results,** so its sources are the links its answer gives; Claude's take their titles from
  its search results.
- **The real-Codex check** covers the per-thread search setting (`docs/real-codex-check.md`).
