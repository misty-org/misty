export type Tone = "info" | "warning" | "danger" | "success";

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "code"; code: string; label?: string }
  | { type: "callout"; tone: Tone; title: string; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | {
      type: "steps";
      items: Array<{ title: string; text: string; code?: string }>;
    }
  | {
      type: "table";
      columns: string[];
      rows: string[][];
    };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

export interface DocPage {
  path: string;
  title: string;
  eyebrow: string;
  description: string;
  badge?: string;
  command?: string;
  sections: Section[];
}

export interface NavGroup {
  title: string;
  items: Array<{ label: string; path: string; command?: boolean }>;
}

export const p = (text: string): Block => ({ type: "paragraph", text });
export const code = (value: string, label = "Terminal"): Block => ({
  type: "code",
  code: value,
  label,
});
export const note = (
  title: string,
  text: string,
  tone: Tone = "info",
): Block => ({ type: "callout", title, text, tone });
export const list = (items: string[], ordered = false): Block => ({
  type: "list",
  items,
  ordered,
});
export const table = (columns: string[], rows: string[][]): Block => ({
  type: "table",
  columns,
  rows,
});
