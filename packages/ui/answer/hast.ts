import type { ExtraProps } from "react-markdown";

/** An element of formatted Markdown, as react-markdown hands it to the element drawing it. */
export type MarkdownElement = NonNullable<ExtraProps["node"]>;

/** A node of formatted Markdown, as far as reading its text needs. */
type Node = { readonly value?: string; readonly children?: readonly Node[] };

/** All the text in a node, as written. */
export const textOf = (node: Node | undefined): string =>
  node === undefined ? "" : (node.value ?? node.children?.map(textOf).join("") ?? "");

/** An element's child elements with the tag `name`. */
export const childrenNamed = (element: MarkdownElement | undefined, name: string) =>
  (element?.children ?? []).filter(
    (child): child is MarkdownElement => child.type === "element" && child.tagName === name,
  );
