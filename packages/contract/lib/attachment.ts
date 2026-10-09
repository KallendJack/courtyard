import { z } from "zod";

// An attachment as the owner's message records it (#78). Session events need this, so it's kept
// to what that needs: the limits and the checks are in `attachment-file.ts`.

/** The longest file name kept. */
const NAME_MAX_LENGTH = 255;

/** The kinds of photo a model takes. The browser sends every photo as JPEG, HEIC included. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const PDF_TYPE = "application/pdf";

export const PhotoMediaType = z.enum(PHOTO_TYPES);
export type PhotoMediaType = z.infer<typeof PhotoMediaType>;

export const AttachmentId = z.uuid().brand<"AttachmentId">();
export type AttachmentId = z.infer<typeof AttachmentId>;

const attachmentBase = {
  id: AttachmentId,
  name: z.string().min(1).max(NAME_MAX_LENGTH),
  size: z.number().int().positive(),
};

/**
 * An attachment as the owner's message records it, kept in the session's folder by its id: a
 * photo of one of the kinds a model takes, or a PDF.
 */
export const Attachment = z.discriminatedUnion("kind", [
  z.object({ ...attachmentBase, kind: z.literal("photo"), mediaType: PhotoMediaType }),
  z.object({ ...attachmentBase, kind: z.literal("pdf"), mediaType: z.literal(PDF_TYPE) }),
]);
export type Attachment = z.infer<typeof Attachment>;

/** The multipart field a message's JSON goes in when it carries attachments, and its files' field. */
export const MESSAGE_FIELD = "message";
export const ATTACHMENTS_FIELD = "attachments";
