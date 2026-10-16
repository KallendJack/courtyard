# sources

A turn's sources (ADR 0019), worked out the same way for every provider.

**Example:** an answer about winter tyres links two reviews. Under it, Sources lists them with each site's name and
the page's title.

- **Uses:** nothing but the contract.
- **Used by:** `providers/` (each hands over a turn's sources), `prompts/`.

## API

None: the sources reach the browser as one `sources` event.

## How it works

- The pages its answer links to and the pages the model read, each with its site's name and title.
- When it used none: the search results of a provider that gives them (Claude), those whose site the answer names or
  else all of them, each search's top results first, at most 20.
- Also finds the web addresses in the owner's messages, the only pages besides search results that Claude may read.
