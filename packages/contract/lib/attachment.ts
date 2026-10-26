import { z } from "zod";
import { BuildSlug } from "./fabrication/builds.ts";
import { BuildStepId } from "./fabrication/derived.ts";

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
/**
 * The step of a Build the owner was on when they sent a photo from its chat (#786), so a later
 * turn knows it shows the Build as it was then.
 */
export const PhotoTakenAt = z.object({
  build: BuildSlug,
  step: BuildStepId,
  number: z.number().int().positive(),
  title: z.string(),
});
export type PhotoTakenAt = z.infer<typeof PhotoTakenAt>;

/** A photo kept in a session's folder: one the owner attached, or a tool connection's image. */
export const PhotoAttachment = z.object({
  ...attachmentBase,
  kind: z.literal("photo"),
  mediaType: PhotoMediaType,
  takenAt: PhotoTakenAt.optional(),
});
export type PhotoAttachment = z.infer<typeof PhotoAttachment>;

export const Attachment = z.discriminatedUnion("kind", [
  PhotoAttachment,
  z.object({ ...attachmentBase, kind: z.literal("pdf"), mediaType: z.literal(PDF_TYPE) }),
]);
export type Attachment = z.infer<typeof Attachment>;

/** The multipart field a message's JSON goes in when it carries attachments, and its files' field. */
export const MESSAGE_FIELD = "message";
export const ATTACHMENTS_FIELD = "attachments";
