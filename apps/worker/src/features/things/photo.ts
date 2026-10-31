import sharp from "sharp";

// A Thing's photo as it's kept (ADR 0020): resized with `sharp` before it's saved.

/** The longest side of a Thing's kept photo, and the most bytes it takes (ADR 0020). */
const PHOTO = {
  longSides: [1600, 1200, 800],
  maxBytes: 300 * 1024,
  qualities: [80, 70, 60, 50],
} as const;

/**
 * A photo as a Thing keeps it: turned the right way up, its details (GPS included) left out,
 * fitted inside 1600 px and saved as a JPEG of at most 300 KB, at a lower quality, or failing that
 * smaller, when it needs to be. `undefined` when the bytes aren't a photo that can be read.
 */
export const keptPhoto = async (bytes: Uint8Array): Promise<Uint8Array | undefined> => {
  try {
    const upright = await sharp(bytes).rotate().toBuffer();
    let smallest: Uint8Array | undefined;
    for (const side of PHOTO.longSides) {
      const fitted = await sharp(upright)
        .resize(side, side, { fit: "inside", withoutEnlargement: true })
        .toBuffer();
      for (const quality of PHOTO.qualities) {
        smallest = await sharp(fitted).jpeg({ quality, mozjpeg: true }).toBuffer();
        if (smallest.length <= PHOTO.maxBytes) return smallest;
      }
    }
    return smallest;
  } catch {
    return undefined;
  }
};
