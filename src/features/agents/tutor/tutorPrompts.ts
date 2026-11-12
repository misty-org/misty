import type {
  Notebook,
  NotebookChatStyle,
  NotebookSource,
  OverviewLine,
  QuizQuestion,
  Transformation,
  TutorJobKind,
} from "./tutorTypes";

/**
 * What Tutor asks the person's agent, and how it reads the replies. Pure, so it is tested alone.
 * The agent answers in an ordinary chat; a reply that makes something ends in a fenced JSON block
 * or is the Markdown itself.
 */

/** The ones every notebook has, after open-notebook's defaults. */
export const builtinTransformations: Transformation[] = [
  {
    id: "summary",
    title: "Summary",
    prompt:
      "Summarize this source in a few short paragraphs: what it is about, its main claims and what supports them.",
  },
  {
    id: "key-points",
    title: "Key points",
    prompt: "List the key points of this source as short bullets, most important first.",
  },
  {
    id: "questions",
    title: "Questions",
    prompt:
      "Write the questions this source answers, and the ones it raises but leaves open, as two short lists.",
  },
  {
    id: "outline",
    title: "Outline",
    prompt: "Write a nested outline of this source that follows its structure.",
  },
  {
    id: "terms",
    title: "Terms",
    prompt:
      "List the terms and names a reader must know for this source, each with a one-line definition.",
  },
];

/** Bounds the material one turn carries; an engine reads links itself. */
const perSource = 60_000;
const allSources = 180_000;

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[…cut to fit]` : text;
}

/** One source as a turn carries it, numbered so answers can cite it. */
function sourceBlock(source: NotebookSource, index: number, mode: "summary" | "full"): string {
  const head = `[${index}] ${source.title}${source.url ? ` (${source.url})` : ""}`;
  if (mode === "summary" && source.summary) return `${head}\nSummary:\n${source.summary}`;
  if (source.text) return `${head}\n${clip(source.text, perSource)}`;
  if (source.url) return `${head}\nRead this page yourself.`;
  return head;
}

/** The notebook's sources in its context: numbered, with each one's chosen depth. */
export function notebookContext(notebook: Notebook, only?: string[]): string {
  let budget = allSources;
  const blocks: string[] = [];
  notebook.sources.forEach((source, index) => {
    if (only ? !only.includes(source.id) : source.context === "off") return;
    const mode = only ? "full" : source.context === "summary" ? "summary" : "full";
    const block = sourceBlock(source, index + 1, mode);
    if (budget <= 0) return;
    blocks.push(clip(block, budget));
    budget -= block.length;
  });
  const notes = notebook.notes
    .filter((note) => note.origin === "person")
    .slice(0, 8)
    .map((note) => `- ${note.title}: ${clip(note.body, 2000)}`);
  return [
    blocks.length ? `Sources from the notebook “${notebook.title}”:\n\n${blocks.join("\n\n")}` : "",
    notes.length ? `The person's own notes:\n${notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** How a reply that makes something ends: one JSON object in a fenced block, of this shape. */
export function jsonReply(shape: string, note = ""): string {
  return [
    `Reply with only a JSON object in a \`\`\`json fenced block: ${shape}.`,
    note,
    "Don't create or edit any files.",
  ]
    .filter(Boolean)
    .join(" ");
}

const cite =
  "Cite the sources you use by their number in square brackets, like [1] or [2][3], right after the claim.";

/** The notebook's chat style as instructions, or nothing for the default. */
export function chatStyleInstructions(style: NotebookChatStyle | undefined): string {
  if (!style) return "";
  const goal =
    style.goal === "guide"
      ? "Act as a tutor: explain step by step, check what the person already knows, and end with one short question that checks their understanding."
      : style.goal === "custom" && style.custom?.trim()
        ? `The person asks you to answer this way: ${style.custom.trim().slice(0, 2000)}`
        : "";
  const length =
    style.length === "shorter"
      ? "Keep the answer short: a few sentences."
      : style.length === "longer"
        ? "Give a full, detailed answer."
        : "";
  return [goal, length].filter(Boolean).join(" ");
}

/** A question asked of a notebook, in a chat the person reads. */
export function askPrompt(notebook: Notebook, question: string, picked?: string): string {
  const context = picked ?? notebookContext(notebook);
  return [
    context,
    `Answer from these sources. ${cite} Say plainly when the sources don't cover something, then answer from what you know and say that you did.`,
    chatStyleInstructions(notebook.chatStyle),
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Passages picked for a question, each under its source's number so answers can cite it. */
export function passagesContext(
  notebook: Notebook,
  passages: { itemId: string; text: string }[],
): string {
  const blocks = passages.flatMap((passage) => {
    const index = notebook.sources.findIndex((source) => source.id === passage.itemId);
    if (index < 0) return [];
    const source = notebook.sources[index];
    return [
      `[${index + 1}] ${source.title}${source.url ? ` (${source.url})` : ""}\n${passage.text}`,
    ];
  });
  return blocks.length
    ? `Passages from the notebook “${notebook.title}” that bear on the question:\n\n${blocks.join("\n\n")}`
    : notebookContext(notebook);
}

/** What to learn, from a request or a notebook's sources. */
export function material(topic: string, context: string): string {
  return context ? `${context}\n\nFocus: ${topic}` : `Topic: ${topic}`;
}

export function guidePrompt(topic: string, context = ""): string {
  return [
    material(topic, context),
    "Write a definitive study guide on this for someone learning it now. Start from what they must " +
      "already know, build up step by step, explain why as well as what, give a worked example for " +
      "each idea that needs one, call out common mistakes, and end with a short recap. Use headings, " +
      "short paragraphs, lists and code blocks where they help." +
      (context ? ` ${cite}` : ""),
    "Reply with the guide only, in Markdown, starting with a level-one heading that is its title. Don't create or edit any files.",
  ].join("\n\n");
}

export function deckPrompt(topic: string, context = "", count = 20): string {
  return [
    material(topic, context),
    `Make about ${count} flashcards that cover this well, from the basics to the parts people get wrong. ` +
      "Each front asks one thing; each back answers it in a sentence or two. No yes-or-no questions, no " +
      "two cards that ask the same thing.",
    jsonReply('{"title": string, "cards": [{"front": string, "back": string}]}'),
  ].join("\n\n");
}

export function quizPrompt(topic: string, context = "", count = 10): string {
  return [
    material(topic, context),
    `Write a ${count}-question multiple-choice quiz that checks real understanding, not recall of wording. ` +
      "Four choices each, one right, the wrong ones plausible. Explain each answer in a sentence.",
    jsonReply(
      '{"title": string, "questions": [{"question": string, "choices": [string], ' +
        '"answer": number, "explanation": string}]}',
      "answer is the index of the right choice.",
    ),
  ].join("\n\n");
}

/** An audio overview: two hosts talk the material through, after open-notebook's podcasts. */
export function overviewPrompt(topic: string, context = ""): string {
  return [
    material(topic, context),
    "Write the script of an audio overview: two hosts, A and B, talk this through for someone " +
      "learning it, in about 1,200 to 1,600 words. A leads and explains; B asks what a listener " +
      "would ask, pushes back and sums up. Natural speech, short turns, concrete examples, no " +
      "stage directions or sound cues, and no reading out of lists or citations.",
    jsonReply('{"title": string, "lines": [{"speaker": "A" | "B", "text": string}]}'),
  ].join("\n\n");
}

/** A transformation run on one source; its answer becomes a note. */
export function transformationPrompt(
  notebook: Notebook,
  source: NotebookSource,
  transformation: Transformation,
): string {
  return [
    notebookContext(notebook, [source.id]),
    transformation.prompt,
    "Reply with the result only, in Markdown. Don't create or edit any files.",
  ].join("\n\n");
}

/** The summary a source carries in "summary" context. */
export function summaryPrompt(notebook: Notebook, source: NotebookSource): string {
  return [
    notebookContext(notebook, [source.id]),
    "Summarize this source in at most 250 words, keeping every claim, number and name a later question might need.",
    "Reply with the summary only. Don't create or edit any files.",
  ].join("\n\n");
}

/** A lesson in Teach mode, taught from material the person gives. */
export function teachPrompt(topic: string, context = ""): string {
  return context ? `${context}\n\nTeach me this, from these sources: ${topic}` : topic;
}

/** The first fenced JSON block in a reply, or the reply itself when it is one object. */
/** The first object in `text` up to its own closing brace, so stray characters after it don't count. */
function balancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

/** The reply's JSON object: its fenced block, or the object in its text, forgiving stray braces. */
export function jsonOf(reply: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(reply);
  const candidates = [
    fenced?.[1],
    reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1),
    balancedObject(fenced?.[1] ?? reply),
  ];
  for (const text of candidates) {
    if (!text?.trim()) continue;
    try {
      return JSON.parse(text);
    } catch {
      // The next candidate.
    }
  }
  return undefined;
}

export const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export function parseDeck(
  reply: string,
): { title: string; cards: { front: string; back: string }[] } | null {
  const value = jsonOf(reply) as { title?: unknown; cards?: unknown } | undefined;
  if (!value || !Array.isArray(value.cards)) return null;
  const cards = value.cards
    .map((card: { front?: unknown; back?: unknown }) => ({
      front: text(card?.front, 1000),
      back: text(card?.back, 2000),
    }))
    .filter((card) => card.front && card.back)
    .slice(0, 200);
  return cards.length ? { title: text(value.title, 120), cards } : null;
}

export function parseQuiz(reply: string): { title: string; questions: QuizQuestion[] } | null {
  const value = jsonOf(reply) as { title?: unknown; questions?: unknown } | undefined;
  if (!value || !Array.isArray(value.questions)) return null;
  const questions = value.questions
    .map(
      (item: {
        question?: unknown;
        choices?: unknown;
        answer?: unknown;
        explanation?: unknown;
      }) => {
        const choices = Array.isArray(item?.choices)
          ? item.choices
              .map((choice) => text(choice, 500))
              .filter(Boolean)
              .slice(0, 6)
          : [];
        const answer = typeof item?.answer === "number" ? Math.trunc(item.answer) : -1;
        return {
          question: text(item?.question, 1000),
          choices,
          answer,
          explanation: text(item?.explanation, 1000) || undefined,
        };
      },
    )
    .filter(
      (item) =>
        item.question &&
        item.choices.length >= 2 &&
        item.answer >= 0 &&
        item.answer < item.choices.length,
    )
    .slice(0, 50);
  return questions.length ? { title: text(value.title, 120), questions } : null;
}

export function parseOverview(reply: string): { title: string; lines: OverviewLine[] } | null {
  const value = jsonOf(reply) as { title?: unknown; lines?: unknown } | undefined;
  if (!value || !Array.isArray(value.lines)) return null;
  const lines = value.lines
    .map((line: { speaker?: unknown; text?: unknown }) => ({
      speaker: (String(line?.speaker ?? "A")
        .trim()
        .toUpperCase() === "B"
        ? 1
        : 0) as 0 | 1,
      text: text(line?.text, 3000),
    }))
    .filter((line) => line.text)
    .slice(0, 120);
  return lines.length >= 2 ? { title: text(value.title, 120), lines } : null;
}

/** A Markdown reply's title (its first heading) and body. */
export function parseMarkdown(reply: string): { title: string; body: string } | null {
  const body = reply.trim();
  if (!body) return null;
  const heading = /^#{1,3}\s+(.+)$/m.exec(body);
  return { title: heading?.[1].trim().slice(0, 120) ?? "", body };
}

/** The title a run shows while it works. */
export function jobTitle(kind: TutorJobKind, topic: string): string {
  const what = {
    guide: "Guide",
    deck: "Flashcards",
    quiz: "Quiz",
    overview: "Audio overview",
    mindmap: "Mind map",
    slides: "Slides",
    infographic: "Infographic",
    video: "Video overview",
    research: "Finding sources",
    brief: "Notebook overview",
    note: "Note",
    summary: "Summary",
  }[kind];
  const short = topic.trim().replace(/\s+/g, " ");
  return `${what}: ${short.length > 60 ? `${short.slice(0, 59)}…` : short}`;
}
