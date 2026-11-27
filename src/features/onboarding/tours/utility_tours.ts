import type { TourStep } from "@misty/ui";

export const utilityTours = {
  search: {
    label: "Search tour",
    steps: [
      {
        target: "search-input",
        title: "Find anything",
        body: "Type to find a chat, a doc, a file, a setting or something to do.",
      },
      {
        target: "search-list",
        title: "Open it",
        body: "Your recent things show here. Press return to open one.",
      },
      {
        target: "search-hints",
        title: "Shortcuts",
        body: "Start with @ to talk to an agent, / to run a command, or # to look only in this Space.",
      },
    ],
  },
  "add-sources": {
    label: "Add sources tour",
    steps: [
      {
        target: "sources-research",
        title: "Let your AI look",
        body: "Type a topic and your AI finds good pages to learn from.",
      },
      {
        target: "sources-kinds",
        title: "Bring your own",
        body: "Add files from your computer, links to pages or videos, or text you've copied.",
      },
      {
        target: "sources-drop",
        title: "Or drop them in",
        body: "Drag files from your computer straight onto this window.",
      },
      {
        target: "sources-limit",
        title: "How full it is",
        body: "Each notebook holds a set number of sources.",
      },
    ],
  },
  "agent-settings": {
    label: "Agent settings tour",
    steps: [
      {
        target: "agent-avatar",
        title: "Give it a face",
        body: "Pick a picture so you can spot this agent at a glance.",
      },
      {
        target: "agent-role",
        title: "What it does",
        body: "A few words about its job, so you can tell your agents apart.",
      },
      {
        target: "agent-engine",
        title: "Which AI it runs on",
        body: "Choose the engine and the model behind it.",
      },
      {
        target: "agent-instructions",
        title: "How you like to work",
        body: "Tell it about you and your work, so it doesn't have to ask each time.",
      },
    ],
  },
} satisfies Record<string, { label: string; steps: readonly TourStep[] }>;
