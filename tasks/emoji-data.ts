import { writeFileSync } from "node:fs";

const emojiTestUrl = "https://unicode.org/Public/17.0.0/emoji/emoji-test.txt";
const annotationsUrl =
  "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-full/annotations/en/annotations.json";
const derivedUrl =
  "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-derived-full/annotationsDerived/en/annotations.json";
const output = new URL("../src/features/spaces/chat/emoji/emojis.json", import.meta.url);

type Category = "people" | "nature" | "food" | "activity" | "travel" | "objects" | "symbols" | "flags";

interface Emoji {
  names: string[];
  surrogates: string;
  keywords?: string[];
  skins?: { names: string[]; surrogates: string }[];
}

const groups: Record<string, Category | undefined> = {
  "Smileys & Emotion": "people",
  "People & Body": "people",
  "Animals & Nature": "nature",
  "Food & Drink": "food",
  Activities: "activity",
  "Travel & Places": "travel",
  Objects: "objects",
  Symbols: "symbols",
  Flags: "flags",
};

const tones = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

type Annotations = Record<string, { default?: string[]; tts?: string[] }>;

function annotationsOf(json: string): Annotations {
  const parsed = JSON.parse(json) as {
    annotations?: { annotations: Annotations };
    annotationsDerived?: { annotations: Annotations };
  };
  return (parsed.annotations ?? parsed.annotationsDerived)?.annotations ?? {};
}

function nameOf(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”"'’.!,:()]/g, "")
    .replace(/&/g, "and")
    .replace(/#/g, "hash")
    .replace(/\*/g, "asterisk")
    .replace(/[^a-z0-9+-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const bare = (text: string) => text.replace(/️/g, "");
const untoned = (text: string) => bare(tones.reduce((rest, tone) => rest.split(tone).join(""), text));

const [testFile, annotationsJson, derivedJson] = await Promise.all([
  fetchText(emojiTestUrl),
  fetchText(annotationsUrl),
  fetchText(derivedUrl),
]);
const annotations = { ...annotationsOf(derivedJson), ...annotationsOf(annotationsJson) };

const categories: Record<Category, Emoji[]> = {
  people: [],
  nature: [],
  food: [],
  activity: [],
  travel: [],
  objects: [],
  symbols: [],
  flags: [],
};
const bases = new Map<string, Emoji>();
let category: Category | undefined;

for (const line of testFile.split("\n")) {
  const group = /^# group: (.+)$/.exec(line);
  if (group) {
    category = groups[group[1].trim()];
    continue;
  }
  const entry = /^[0-9A-F ]+;\s*fully-qualified\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/.exec(line);
  if (!entry || !category) continue;
  const [, surrogates, label] = entry;
  const toneCount = tones.filter((tone) => surrogates.includes(tone)).length;
  if (toneCount > 0) {
    const base = bases.get(untoned(surrogates));
    const used = new Set(tones.filter((tone) => surrogates.includes(tone)));
    if (!base || used.size !== 1) continue;
    const tone = tones.indexOf([...used][0]);
    base.skins ??= [];
    base.skins[tone] = { names: [`${base.names[0]}_tone${tone + 1}`], surrogates };
    continue;
  }
  const annotation = annotations[surrogates] ?? annotations[bare(surrogates)];
  const name = nameOf(annotation?.tts?.[0] ?? label);
  const keywords = (annotation?.default ?? [])
    .map((keyword) => keyword.toLowerCase())
    .filter((keyword) => keyword !== name.replace(/_/g, " "));
  const emoji: Emoji = { names: [name], surrogates };
  if (keywords.length) emoji.keywords = [...new Set(keywords)].sort();
  categories[category].push(emoji);
  bases.set(bare(surrogates), emoji);
}

for (const list of Object.values(categories))
  for (const emoji of list)
    if (emoji.skins && emoji.skins.filter(Boolean).length !== tones.length) delete emoji.skins;

writeFileSync(output, `${JSON.stringify({ categories })}\n`);
