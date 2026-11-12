import { jsonOf, jsonReply, material, text } from "./tutorPrompts";
import type { MindNode, Notebook } from "./tutorTypes";

/**
 * The Studio's own prompts and how their replies read: mind maps, slides, reports, finding
 * sources on the web, and the notebook's overview. Pure, so it is tested alone.
 */

/** Reports a guide run can write, each a Markdown document of its own shape. */
export const reports: { id: string; title: string; ask: string }[] = [
  {
    id: "study-guide",
    title: "Study guide",
    ask:
      "Write a definitive study guide for someone learning this now: build up step by step, " +
      "explain why as well as what, give worked examples, call out common mistakes, and end with " +
      "a short recap.",
  },
  {
    id: "briefing",
    title: "Briefing doc",
    ask:
      "Write a briefing document: the main themes, the most important facts and claims, and what " +
      "they mean, for someone who has ten minutes before a meeting about it.",
  },
  {
    id: "faq",
    title: "FAQ",
    ask: "Write the questions a learner would ask about this, each with a clear, complete answer.",
  },
  {
    id: "timeline",
    title: "Timeline",
    ask:
      "Write a timeline of the events, people and developments in this, in order, each with its " +
      "date and why it mattered, followed by a short cast of the people involved.",
  },
  {
    id: "data-table",
    title: "Data table",
    ask:
      "Pull the comparable facts out of this into one or more Markdown tables, with a column for " +
      "what each row is and a short note under each table on what it shows.",
  },
];

export function reportPrompt(report: string, topic: string, context = "", cite = ""): string {
  const shape = reports.find((item) => item.id === report) ?? reports[0];
  return [
    material(topic, context),
    `${shape.ask} ${cite}`.trim(),
    "Use headings, short paragraphs, lists and tables where they help. Reply with the document " +
      "only, in Markdown, starting with a level-one heading that is its title. Don't create or " +
      "edit any files.",
  ].join("\n\n");
}

export function mindmapPrompt(topic: string, context = ""): string {
  return [
    material(topic, context),
    "Make a mind map of this: one central idea, four to seven main branches, and under each the " +
      "ideas that belong to it, at most four levels deep. Labels are short phrases, not sentences.",
    jsonReply('{"title": string, "root": {"label": string, "children": [the same shape]}}'),
  ].join("\n\n");
}

export function slidesPrompt(topic: string, context = ""): string {
  return [
    material(topic, context),
    "Make a slide deck that teaches this in eight to fourteen slides. Each slide has a heading " +
      "and at most five short bullets or one small table; put what a presenter would say under a " +
      "line starting with `Notes:`.",
    "Reply with the deck only, in Markdown: the first slide starts with a level-one heading that " +
      "is the deck's title, and slides are separated by a line with only `---`. Don't create or " +
      "edit any files.",
  ].join("\n\n");
}

export function researchPrompt(topic: string, have: string[] = []): string {
  return [
    `Find the best sources on the web for learning about: ${topic}`,
    "Search the web and pick six to ten pages, papers or videos that together cover it well: " +
      "an overview, the fundamentals, worked examples, and one or two deeper ones. Prefer " +
      "primary sources, official documentation, reputable courses and well-known explainers. " +
      "Only include addresses you actually found and opened.",
    have.length ? `The notebook already has these; don't repeat them:\n${have.join("\n")}` : "",
    jsonReply(
      '{"sources": [{"title": string, "url": string, "why": string}]}',
      "why is one short sentence.",
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The overview at the top of a notebook: from its sources, or from its title before it has any. */
export function briefPrompt(notebook: Notebook, context: string): string {
  return [
    context || `A new notebook about: ${notebook.title}`,
    "Write this notebook's overview: one emoji for its cover, a short title, a summary of what " +
      "the sources cover in one paragraph of three to five sentences with the key terms in " +
      "**bold**, three to six topics, and three questions a learner could ask to start.",
    jsonReply(
      '{"emoji": string, "title": string, "summary": string, "topics": [string], ' +
        '"questions": [string]}',
    ),
  ].join("\n\n");
}

/** Which sources an overview was written from, so a change asks for a new one. */
export function briefKey(notebook: Notebook): string {
  return notebook.sources
    .filter((source) => source.context !== "off")
    .map((source) => `${source.id}:${(source.text ?? "").length}`)
    .sort()
    .join(",");
}

function nodeOf(value: unknown, depth: number): MindNode | null {
  const item = value as { label?: unknown; children?: unknown } | null;
  const label = text(item?.label, 120);
  if (!label) return null;
  const children =
    depth < 5 && Array.isArray(item?.children)
      ? item.children
          .map((child) => nodeOf(child, depth + 1))
          .filter((child): child is MindNode => Boolean(child))
          .slice(0, 12)
      : [];
  return children.length ? { label, children } : { label };
}

export function parseMindmap(reply: string): { title: string; root: MindNode } | null {
  const value = jsonOf(reply) as { title?: unknown; root?: unknown } | undefined;
  const root = value ? nodeOf(value.root, 0) : null;
  return root?.children?.length ? { title: text(value?.title, 120) || root.label, root } : null;
}

/** A deck's slides, split at lines holding only ---. */
export function slidesOf(body: string): string[] {
  return body
    .split(/^\s*---\s*$/m)
    .map((slide) => slide.trim())
    .filter(Boolean);
}

export function parseResearch(reply: string): { title: string; url: string; why: string }[] {
  const value = jsonOf(reply) as { sources?: unknown } | undefined;
  if (!value || !Array.isArray(value.sources)) return [];
  const seen = new Set<string>();
  return value.sources
    .flatMap((item: { title?: unknown; url?: unknown; why?: unknown }) => {
      const url = text(item?.url, 2000);
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol) || seen.has(parsed.href)) return [];
        seen.add(parsed.href);
        return [
          {
            title: text(item?.title, 160) || parsed.hostname,
            url: parsed.href,
            why: text(item?.why, 300),
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 12);
}

export function parseBrief(reply: string): {
  emoji: string;
  title: string;
  summary: string;
  topics: string[];
  questions: string[];
} | null {
  const value = jsonOf(reply) as Record<string, unknown> | undefined;
  const summary = text(value?.summary, 2000);
  if (!value || !summary) return null;
  const list = (key: string, limit: number) =>
    Array.isArray(value[key])
      ? (value[key] as unknown[])
          .map((item) => text(item, 200))
          .filter(Boolean)
          .slice(0, limit)
      : [];
  // One emoji, with its joined parts, whatever else came with it.
  const emoji =
    /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/u.exec(
      text(value.emoji, 16),
    )?.[0] ?? "";
  return {
    emoji,
    title: text(value.title, 120),
    summary,
    topics: list("topics", 8),
    questions: list("questions", 4),
  };
}

/** The colors an engine draws with, so what it makes sits in Misty's dark theme. */
const palette =
  "background #141414, panels #1e1e1e, lines #3a3a3a, text #f2efe9 and #a8a49c, and at most " +
  "three accents from #7c9cff, #43c6b8, #e9b949, #ee86bd, #5ac987";

const svgRules =
  "Draw it as one self-contained SVG: no scripts, no event attributes, no foreignObject, no " +
  "external images, links or fonts (use font-family system-ui, sans-serif), every shape and " +
  "text inside the viewBox, and text large enough to read when the image is shown small. SVG " +
  "text doesn't wrap by itself: break long lines into <tspan> lines, and keep each line at least " +
  "24px inside the panel or box it sits in.";

export function infographicPrompt(topic: string, context = ""): string {
  return [
    material(topic, context),
    "Design an infographic that teaches this at a glance: a title, four to seven sections built " +
      "from simple shapes, icons drawn as paths, numbers, short labels and arrows, laid out in a " +
      `clear reading order. Use ${palette}.`,
    `${svgRules} Use viewBox="0 0 1080 1350".`,
    "Reply with only the SVG in a ```svg fenced block. Don't create or edit any files.",
  ].join("\n\n");
}

export function videoPrompt(topic: string, context = ""): string {
  return [
    material(topic, context),
    "Make a video overview: six to ten scenes that teach this in two to four minutes, from the " +
      "big picture to the details and a recap. Each scene has a short heading, up to four short " +
      "points, the narration spoken over it (two to four natural sentences), and an illustration " +
      `that shows the idea: a diagram, a process, a comparison or a labelled drawing. Use ${palette}. ` +
      "Each scene also has a shot: one paragraph a video model films as a silent clip of five to " +
      "ten seconds behind the narration, saying the subject, what moves, the setting, the camera " +
      "and the light. A shot shows things happening and has no words, letters or captions on screen.",
    `${svgRules} Each illustration uses viewBox="0 0 1280 720" and leaves the bottom 120 pixels ` +
      "clear for captions.",
    jsonReply(
      '{"title": string, "scenes": [{"heading": string, "points": [string], ' +
        '"narration": string, "shot": string, "svg": string}]}',
      "svg is the scene's SVG as a string.",
    ),
  ].join("\n\n");
}

/**
 * An SVG an engine drew, made safe to keep: no scripts, event attributes, foreignObject or links
 * out. It is only ever shown as an image, which runs nothing anyway.
 */
export function cleanSvg(svg: string): string | null {
  const start = svg.search(/<svg[\s>]/i);
  const end = svg.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  const clean = svg
    .slice(start, end + "</svg>".length)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "");
  const withNamespace = /xmlns\s*=/.test(clean.slice(0, 400))
    ? clean
    : clean.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return withNamespace.length <= 600_000 ? withNamespace : null;
}

export function parseInfographic(reply: string): string | null {
  const fenced = /```(?:svg|xml|html)?\s*\n([\s\S]*?)```/i.exec(reply);
  return cleanSvg(fenced?.[1] ?? reply);
}

export function parseVideo(reply: string): {
  title: string;
  scenes: { heading: string; points: string[]; narration: string; shot?: string; svg?: string }[];
} | null {
  const value = jsonOf(reply) as { title?: unknown; scenes?: unknown } | undefined;
  if (!value || !Array.isArray(value.scenes)) return null;
  const scenes = value.scenes
    .map((scene: Record<string, unknown>) => {
      const svg = typeof scene?.svg === "string" ? cleanSvg(scene.svg) : null;
      const shot = text(scene?.shot, 1200);
      return {
        heading: text(scene?.heading, 160),
        points: Array.isArray(scene?.points)
          ? scene.points
              .map((point) => text(point, 200))
              .filter(Boolean)
              .slice(0, 5)
          : [],
        narration: text(scene?.narration, 1200),
        ...(shot ? { shot } : {}),
        ...(svg ? { svg } : {}),
      };
    })
    .filter((scene) => scene.heading && scene.narration)
    .slice(0, 16);
  return scenes.length >= 2 ? { title: text(value.title, 120), scenes } : null;
}
