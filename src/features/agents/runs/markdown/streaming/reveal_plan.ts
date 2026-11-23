// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { Element, Root as Tree } from "hast";
type Transform = (tree: Tree, file?: unknown) => void;

export function createRevealPlan(
  options: { base?: () => number; onText?: (text: string) => void } = {},
) {
  const plan = { text: "", plugin: () => transform };
  const textParents = new Set([
    "p",
    "span",
    "strong",
    "em",
    "del",
    "a",
    "code",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "td",
    "th",
    "blockquote",
    "div",
  ]);
  const isOpaque = (node: Element) => {
    const classes = (node.properties?.className as unknown[]) ?? [];
    return classes.some(
      (name) => name === "katex" || name === "katex-display" || name === "katex-html",
    );
  };
  const transform: Transform = (tree) => {
    let offset = options.base?.() ?? 0;
    const parts: string[] = [];
    function children(parent: Tree | Element): Element["children"] {
      return parent.children.map((node) => {
        if (node.type === "element") {
          if (isOpaque(node)) return node;
          return { ...node, children: children(node) };
        }
        if (node.type !== "text" || parent.type !== "element" || !textParents.has(parent.tagName))
          return node;
        const start = offset;
        offset += node.value.length;
        parts.push(node.value);
        return {
          type: "element",
          tagName: "span",
          properties: { dataStreamStart: start },
          children: [node],
        } as Element;
      }) as Element["children"];
    }
    tree.children = children(tree);
    plan.text = parts.join("");
    options.onText?.(plan.text);
  };
  return plan;
}
