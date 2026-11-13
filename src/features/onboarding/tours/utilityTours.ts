import type { TourStep } from "@/shared/ui";

/**
 * The tours of Misty's utility surfaces: help, search, the layout popup and the agents dialogs.
 * Settings has none: it is a list of labeled rows that explains itself. They join the rest in `tours` (tours.ts), written the same way.
 */
export const utilityTours = {
  help: {
    label: "Help tour",
    steps: [
      {
        target: "help-start",
        title: "Getting started",
        body: "Take a tour of the page you're on, or set up your AI and apps again.",
      },
      {
        target: "help-recover",
        title: "When something's stuck",
        body: "Safe fixes for when a tab goes missing or the app stops responding. Your work isn't deleted.",
      },
      {
        target: "help-feedback",
        title: "Tell us",
        body: "Report a problem or share an idea. You can save a file that helps us find the problem; nothing is sent by itself.",
      },
    ],
  },
  search: {
    label: "Search tour",
    steps: [
      {
        target: "search-input",
        title: "Find anything",
        body: "Type to find a chat, a doc, a file, a setting or something to do.",
      },
      {
        target: "search-kinds",
        title: "Narrow it down",
        body: "Look in one kind of thing at a time.",
      },
      {
        target: "search-list",
        title: "Open it",
        body: "Your recent things show here. Press return to open one.",
      },
      {
        target: "search-hints",
        title: "Shortcuts",
        body: "Start with @ to talk to an agent, or / to run a command.",
      },
    ],
  },
  layout: {
    label: "Layout tour",
    steps: [
      {
        target: "layout-tabs",
        title: "Your tabs",
        body: "These are your open tabs. Click one to add it, or drag it onto the picture.",
      },
      {
        target: "layout-canvas",
        title: "Arrange your window",
        body: "A small picture of your window. Drop a tab on an edge to split, or in the middle to swap. Drag a box to move it.",
      },
      {
        target: "layout-apply",
        title: "Try it out",
        body: "Nothing changes until you press Apply.",
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
        target: "agent-permissions",
        title: "How much it asks",
        body: "Choose whether it checks with you first or just gets on with it.",
      },
      {
        target: "agent-instructions",
        title: "How you like to work",
        body: "Tell it about you and your work, so it doesn't have to ask each time.",
      },
    ],
  },
} satisfies Record<string, { label: string; steps: readonly TourStep[] }>;
