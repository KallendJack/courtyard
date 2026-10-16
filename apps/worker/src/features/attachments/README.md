# attachments

The photos and PDFs sent with a message (#78).

**Example:** you send a photo of a worn tyre. It's checked, kept in the session's folder, and the next turns can see
it.

- **Uses:** `providers/` (the turn's input shape).
- **Used by:** `sessions/`, `things/` (a photo saved as a Thing's), `prompts/` (a PDF's text in the message).

## API

None of its own: they arrive with `sessions/`' messages and are read back from
`GET /api/sessions/:id/attachments/:attachment`.

## How it works

- Checks each again as the browser did: Zod for its kind, size and the count, then that its first bytes are that
  kind.
- Pulls a PDF's text out with `unpdf`, and refuses one with none.
- Keeps them in the session's folder, and gives each turn the session's last ten.
