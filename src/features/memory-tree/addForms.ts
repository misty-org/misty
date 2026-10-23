import { type MemoryBranch } from "./model";

export const FACT_KINDS = [
  { value: "fact", label: "Fact" },
  { value: "preference", label: "Preference" },
  { value: "instruction", label: "Instruction" },
] as const;

export interface AddForm {
  /** The menu row and the dialog's title. */
  menu: string;
  help: string;
  titleLabel?: string;
  titleRequired?: boolean;
  descriptionLabel?: string;
  textLabel: string;
  textMax: number;
  kinds?: boolean;
}

/** What each branch asks for when you add to it by hand. The branches themselves are fixed. */
export const addForms: Record<MemoryBranch, AddForm> = {
  moments: {
    menu: "Add a note",
    help: "A note in your own words. You and your agents can find it by meaning.",
    titleLabel: "Title (optional)",
    textLabel: "Note",
    textMax: 20000,
  },
  summaries: {
    menu: "Add a summary",
    help: "A recap you wrote, kept with the ones Misty writes.",
    titleLabel: "Title",
    titleRequired: true,
    textLabel: "Summary",
    textMax: 20000,
  },
  facts: {
    menu: "Add a fact",
    help: "Something Misty should remember about you, like a preference or how you like things done.",
    textLabel: "What should Misty remember?",
    textMax: 1000,
    kinds: true,
  },
  workflows: {
    menu: "Add a workflow",
    help: "Steps Misty can follow again, saved under your Misty agent.",
    titleLabel: "Name",
    titleRequired: true,
    descriptionLabel: "What it's for (optional)",
    textLabel: "Instructions",
    textMax: 6000,
  },
};

export const addOrder: MemoryBranch[] = ["moments", "summaries", "facts", "workflows"];
