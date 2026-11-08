import { type MemoryBranch } from "./memoryNodes";

export const FACT_KINDS = [
  { value: "fact", label: "Fact" },
  { value: "preference", label: "Preference" },
  { value: "instruction", label: "Instruction" },
] as const;

interface AddForm {
  /** The menu row and the dialog's title. */
  menu: string;
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
    titleLabel: "Title (optional)",
    textLabel: "Note",
    textMax: 20000,
  },
  summaries: {
    menu: "Add a summary",
    titleLabel: "Title",
    titleRequired: true,
    textLabel: "Summary",
    textMax: 20000,
  },
  facts: {
    menu: "Add a fact",
    textLabel: "What should Misty remember?",
    textMax: 1000,
    kinds: true,
  },
  workflows: {
    menu: "Add a workflow",
    titleLabel: "Name",
    titleRequired: true,
    descriptionLabel: "What it's for (optional)",
    textLabel: "Instructions",
    textMax: 6000,
  },
};

export const addOrder: MemoryBranch[] = ["moments", "summaries", "facts", "workflows"];
