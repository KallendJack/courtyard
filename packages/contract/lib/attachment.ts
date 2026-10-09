import { z } from "zod";

// An attachment as the owner's message records it (#78). Every session event needs this, so it's
// kept to what that needs: the limits and the checks are in `attachment-file.ts`.

/** The longest file name kept. */
const NAME_MAX_LENGTH = 255;

export const AttachmentId = z.uuid().brand<"AttachmentId">();
export type AttachmentId = z.infer<typeof AttachmentId>;

/**
 * An attachment as the owner's message records it: kept in the session's folder by its id. Its
 * media type was checked when it came in (`AttachmentMediaType`).
 */
export const Attachment = z.object({
  id: AttachmentId,
  name: z.string().min(1).max(NAME_MAX_LENGTH),
  kind: z.enum(["photo", "pdf"]),
  mediaType: z.string(),
  size: z.number().int().positive(),
});
export type Attachment = z.infer<typeof Attachment>;

/** The multipart field a message's JSON goes in when it carries attachments, and its files' field. */
export const MESSAGE_FIELD = "message";
export const ATTACHMENTS_FIELD = "attachments";
