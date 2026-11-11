/** What the picker reports about an element in the previewed page (`preview_picker.js`). */
export interface PickedElement {
  url: string;
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
  html: string;
  htmlTruncated: boolean;
  /** The page's recent errors, from when Misty began watching it. */
  errors: string[];
}

/** The styles the card and the message list, in this order. */
export const styleNames = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background",
  "font",
] as const;

const text = (value: unknown, most: number) =>
  typeof value === "string" ? value.slice(0, most) : "";
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const texts = (value: unknown, count: number, most: number) =>
  Array.isArray(value)
    ? value
        .slice(0, count)
        .map((item) => text(item, most))
        .filter(Boolean)
    : [];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * Reads a pick as it came from the page. The page is the person's own app, but what it says is
 * still only data: every field is checked and cut to size, and anything else is dropped.
 */
export function readPickedElement(value: unknown): PickedElement | null {
  const raw = record(value);
  const selector = text(raw.selector, 1024);
  const tag = text(raw.tag, 64);
  if (!selector || !tag) return null;
  const rect = record(raw.rect);
  const rawStyles = record(raw.styles);
  const styles: Record<string, string> = {};
  for (const name of styleNames) {
    const style = text(rawStyles[name], 240);
    if (style) styles[name] = style;
  }
  return {
    url: text(raw.url, 2048),
    selector,
    tag,
    id: text(raw.id, 256),
    classes: texts(raw.classes, 24, 128),
    text: text(raw.text, 240),
    rect: {
      x: number(rect.x),
      y: number(rect.y),
      width: number(rect.width),
      height: number(rect.height),
    },
    styles,
    html: text(raw.html, 4200),
    htmlTruncated: raw.htmlTruncated === true,
    errors: texts(raw.errors, 8, 400),
  };
}

/** An element's size as the card shows it: `320 × 48`. */
export function sizeLabel(element: PickedElement): string {
  return `${Math.round(element.rect.width)} × ${Math.round(element.rect.height)}`;
}

/** A fence longer than any run of backticks in `content`, so the content can't end it early. */
function fence(content: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(longest + 1);
}

/**
 * The picked element as text for the chat's composer: a line saying what it is, then its details
 * and its HTML in fenced blocks the person can edit before sending.
 */
export function formatElementBlock(element: PickedElement): string {
  const { rect } = element;
  const details = [
    `selector: ${element.selector}`,
    `tag: ${element.tag}`,
    element.id ? `id: ${element.id}` : "",
    element.classes.length ? `classes: ${element.classes.join(" ")}` : "",
    element.text ? `text: ${element.text}` : "",
    `box: ${sizeLabel(element)} at ${Math.round(rect.x)}, ${Math.round(rect.y)}`,
    ...styleNames
      .filter((name) => element.styles[name])
      .map((name) => `${name}: ${element.styles[name]}`),
  ]
    .filter(Boolean)
    .join("\n");
  const detailFence = fence(details);
  const htmlFence = fence(element.html);
  const parts = [
    `About this element in my app's preview${element.url ? ` (${element.url})` : ""}:`,
    `${detailFence}\n${details}\n${detailFence}`,
  ];
  if (element.html)
    parts.push(
      `${htmlFence}html\n${element.html}\n${htmlFence}${element.htmlTruncated ? "\n(HTML cut at 4 KB)" : ""}`,
    );
  if (element.errors.length) {
    const errors = element.errors.join("\n");
    const errorFence = fence(errors);
    parts.push(`Recent errors on the page:\n${errorFence}\n${errors}\n${errorFence}`);
  }
  return `${parts.join("\n\n")}\n\n`;
}

/** The composer's text with the element added after whatever the person had already written. */
export function withElementBlock(draft: string, element: PickedElement): string {
  const block = formatElementBlock(element);
  return draft.trim() ? `${draft.replace(/\s+$/, "")}\n\n${block}` : block;
}
