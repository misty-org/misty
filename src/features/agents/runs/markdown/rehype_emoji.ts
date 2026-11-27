import { splitEmoji } from "@misty/ui";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const VERBATIM = new Set(["code", "pre", "kbd", "samp", "script", "style"]);

export function rehypeEmoji() {
  const walk = (node: HastNode) => {
    if (node.type === "element" && VERBATIM.has(node.tagName ?? "")) return;
    if (!node.children) return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== "text" || !child.value) {
        walk(child);
        return [child];
      }
      const pieces = splitEmoji(child.value);
      if (pieces.length === 1 && "text" in pieces[0]!) return [child];
      return pieces.map((piece) =>
        "emoji" in piece
          ? {
              type: "element",
              tagName: "span",
              properties: { dataEmoji: piece.emoji },
              children: [{ type: "text", value: piece.emoji }],
            }
          : { type: "text", value: piece.text },
      );
    });
  };
  return (tree: HastNode) => walk(tree);
}
