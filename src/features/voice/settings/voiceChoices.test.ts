import { expect, it } from "vitest";
import { hasNaturalVoice, voiceQuality, voicesFor } from "./voiceChoices";

const voices = [
  { id: "samantha", name: "Samantha", language: "en_US" },
  { id: "ava-premium", name: "Ava (Premium)", language: "en_US" },
  { id: "zoe-enhanced", name: "Zoe (Enhanced)", language: "en-GB" },
  { id: "thomas", name: "Thomas", language: "fr_FR" },
];

it("offers the language's voices, Premium, then Enhanced, then the rest", () => {
  expect(voicesFor(voices, "en", "", "fr-FR").map((voice) => voice.id)).toEqual([
    "ava-premium",
    "zoe-enhanced",
    "samantha",
  ]);
  // "auto" is the system's language.
  expect(voicesFor(voices, "auto", "", "fr-FR").map((voice) => voice.id)).toEqual(["thomas"]);
});

it("keeps the chosen voice whatever it speaks", () => {
  expect(voicesFor(voices, "fr", "samantha", "en").map((voice) => voice.id)).toEqual([
    "samantha",
    "thomas",
  ]);
});

it("knows a natural voice by its name", () => {
  expect(voiceQuality({ name: "Ava (Premium)" })).toBe(2);
  expect(voiceQuality({ name: "Zoe (Enhanced)" })).toBe(1);
  expect(voiceQuality({ name: "Samantha" })).toBe(0);
  expect(hasNaturalVoice(voicesFor(voices, "fr", "", "en"))).toBe(false);
});
