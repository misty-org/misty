import {
  AudioLines,
  Brain,
  Globe,
  History,
  Lightbulb,
  type LucideIcon,
  Mic,
  Monitor,
  Notebook,
  Route,
  StickyNote,
} from "lucide-react";
import { itemToneClass, itemTones } from "@/shared/ui";
import { type MemoryNode } from "../model";

const sourceIcons: Record<string, LucideIcon> = {
  page: Globe,
  screen: Monitor,
  voice: Mic,
  recording: AudioLines,
  note: StickyNote,
};

const branchIcons = {
  moments: History,
  summaries: Notebook,
  facts: Lightbulb,
  workflows: Route,
} as const;

const branchTones = {
  moments: itemTones.memoryMoment,
  summaries: itemTones.memorySummary,
  facts: itemTones.memoryFact,
  workflows: itemTones.memoryWorkflow,
} as const;

/**
 * The glyph of a node and its tone class. Tone marks what a memory is, never its state; the
 * Space root keeps the plain text color.
 */
export function nodeVisual(node: MemoryNode | null): { Icon: LucideIcon; toneClass: string } {
  if (!node) return { Icon: Brain, toneClass: "text-cream-bright" };
  if (node.source === "screen")
    return { Icon: Monitor, toneClass: itemToneClass(itemTones.memoryScreen) };
  const Icon =
    node.type === "branch" || !node.source
      ? branchIcons[node.branch]
      : (sourceIcons[node.source] ?? branchIcons[node.branch]);
  return { Icon, toneClass: itemToneClass(branchTones[node.branch]) };
}
