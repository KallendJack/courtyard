// The little of opentype.js (MIT, https://github.com/opentypejs/opentype.js) that lettering uses:
// it ships no types of its own.

declare module "opentype.js" {
  type PathCommand =
    | { readonly type: "M" | "L"; readonly x: number; readonly y: number }
    | {
        readonly type: "Q";
        readonly x1: number;
        readonly y1: number;
        readonly x: number;
        readonly y: number;
      }
    | {
        readonly type: "C";
        readonly x1: number;
        readonly y1: number;
        readonly x2: number;
        readonly y2: number;
        readonly x: number;
        readonly y: number;
      }
    | { readonly type: "Z" };

  export type Font = {
    readonly unitsPerEm: number;
    readonly tables: { readonly os2?: { readonly sCapHeight?: number } };
    getPath(
      text: string,
      x: number,
      y: number,
      fontSize: number,
    ): { readonly commands: readonly PathCommand[] };
  };

  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
