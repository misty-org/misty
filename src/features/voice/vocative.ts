export type VocativeAgent = { id: string; name: string };
export type Vocative = { agent: VocativeAgent; message: string };

const greetings = [
  "hey",
  "hi",
  "hello",
  "ok",
  "okay",
  "yo",
  "hola",
  "oye",
  "oi",
  "olá",
  "ola",
  "salut",
  "coucou",
  "hallo",
  "hej",
  "hei",
  "ciao",
  "ehi",
  "ei",
  "ey",
  "привет",
  "эй",
  "ねえ",
  "ね",
  "嘿",
  "喂",
  "嗨",
  "야",
  "헤이",
  "안녕",
];

const normalize = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

const tolerance = (name: string) => (name.length >= 8 ? 2 : name.length >= 4 ? 1 : 0);

const words = (text: string) => text.split(/[\s,，、。.!?！？:;]+/u).filter(Boolean);

export function matchVocative(transcript: string, agents: VocativeAgent[]): Vocative | null {
  const text = transcript.trim();
  const spoken = words(text);
  const first = normalize(spoken[0] ?? "");
  if (!greetings.includes(first) || spoken.length < 3) return null;
  let best: { agent: VocativeAgent; score: number; nameWords: number } | null = null;
  let tie = false;
  for (const agent of agents) {
    const nameWords = words(agent.name).length;
    if (!nameWords) continue;
    const heard = normalize(spoken.slice(1, 1 + nameWords).join(" "));
    const name = normalize(words(agent.name).join(" "));
    const score = distance(heard, name);
    if (score > tolerance(name)) continue;
    if (!best || score < best.score) {
      best = { agent, score, nameWords };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  if (!best || tie) return null;
  let rest = text;
  for (let i = 0; i < 1 + best.nameWords; i++)
    rest = rest.replace(/^[\s,，、。.!?！？:;]*[^\s,，、。.!?！？:;]+/u, "");
  const message = rest.replace(/^[\s,，、。.!?！？:;]+/u, "").trim();
  return message ? { agent: best.agent, message } : null;
}
