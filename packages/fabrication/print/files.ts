import type { Made } from "./make.ts";

// A made part as the files a slicer opens (#702): 3MF, which Bambu Studio opens as a project, and
// STL, which every slicer reads. Both in mm.

type Mesh = Pick<Made, "positions" | "triangles">;

/** Text as bytes, each character one: everything written here is ASCII, names escaped first. */
const ascii = (text: string) =>
  Uint8Array.from(text, (character) => character.charCodeAt(0) & 0x7f);

/** A binary STL: an 80-byte header, the count, then each triangle's normal and corners. */
export const toStl = (mesh: Mesh, name: string): Uint8Array => {
  const count = mesh.triangles.length / 3;
  const bytes = new Uint8Array(84 + count * 50);
  const view = new DataView(bytes.buffer);
  bytes.set(ascii(name.replace(/[^ -~]/g, "?").slice(0, 80)), 0);
  view.setUint32(80, count, true);
  const corner = (index: number): [number, number, number] => {
    const at = (mesh.triangles[index] ?? 0) * 3;
    return [mesh.positions[at] ?? 0, mesh.positions[at + 1] ?? 0, mesh.positions[at + 2] ?? 0];
  };
  for (let triangle = 0; triangle < count; triangle += 1) {
    const a = corner(triangle * 3);
    const b = corner(triangle * 3 + 1);
    const c = corner(triangle * 3 + 2);
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(...normal) || 1;
    const offset = 84 + triangle * 50;
    [...normal.map((each) => each / length), ...a, ...b, ...c].forEach((value, index) => {
      view.setFloat32(offset + index * 4, value, true);
    });
  }
  return bytes;
};

/** Text for XML, in ASCII: markup's own characters and anything past ASCII as their numbers. */
const escapeXml = (text: string) =>
  text.replace(/[<>&"']|[^ -~]/gu, (character) => `&#${character.codePointAt(0)};`);

/** The 3MF's model: one object, its corners and triangles, in mm. */
const modelXml = (mesh: Mesh, name: string) => {
  const vertices: string[] = [];
  for (let at = 0; at < mesh.positions.length; at += 3) {
    vertices.push(
      `<vertex x="${mesh.positions[at]}" y="${mesh.positions[at + 1]}" z="${mesh.positions[at + 2]}"/>`,
    );
  }
  const triangles: string[] = [];
  for (let at = 0; at < mesh.triangles.length; at += 3) {
    triangles.push(
      `<triangle v1="${mesh.triangles[at]}" v2="${mesh.triangles[at + 1]}" v3="${mesh.triangles[at + 2]}"/>`,
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-GB" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<metadata name="Title">${escapeXml(name)}</metadata>`,
    "<resources>",
    `<object id="1" type="model" name="${escapeXml(name)}"><mesh>`,
    `<vertices>${vertices.join("")}</vertices>`,
    `<triangles>${triangles.join("")}</triangles>`,
    "</mesh></object>",
    "</resources>",
    '<build><item objectid="1"/></build>',
    "</model>",
  ].join("\n");
};

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
  "</Types>",
].join("\n");

const RELATIONSHIPS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
  "</Relationships>",
].join("\n");

/** A 3MF: its three files in a zip. */
export const to3mf = (mesh: Mesh, name: string): Uint8Array =>
  zip([
    { path: "[Content_Types].xml", text: CONTENT_TYPES },
    { path: "_rels/.rels", text: RELATIONSHIPS },
    { path: "3D/3dmodel.model", text: modelXml(mesh, name) },
  ]);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * A zip of ASCII text files, stored as they are: a 3MF reader needs no more, and a part's file is
 * small enough that packing it isn't worth a library.
 */
const zip = (files: readonly { path: string; text: string }[]): Uint8Array => {
  const entries = files.map(({ path, text }) => {
    const name = ascii(path);
    const data = ascii(text);
    return { name, data, crc: crc32(data) };
  });
  const locals = entries.reduce((sum, { name, data }) => sum + 30 + name.length + data.length, 0);
  const centrals = entries.reduce((sum, { name }) => sum + 46 + name.length, 0);
  const bytes = new Uint8Array(locals + centrals + 22);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const { name, data, crc } of entries) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint32(at + 14, crc, true);
    view.setUint32(at + 18, data.length, true);
    view.setUint32(at + 22, data.length, true);
    view.setUint16(at + 26, name.length, true);
    bytes.set(name, at + 30);
    bytes.set(data, at + 30 + name.length);
    at += 30 + name.length + data.length;
  }
  const central = at;
  entries.forEach(({ name, data, crc }, index) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint32(at + 16, crc, true);
    view.setUint32(at + 20, data.length, true);
    view.setUint32(at + 24, data.length, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint32(at + 42, offsets[index] ?? 0, true);
    bytes.set(name, at + 46);
    at += 46 + name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - central, true);
  view.setUint32(at + 16, central, true);
  return bytes;
};
