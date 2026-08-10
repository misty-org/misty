export type FeatureId =
  | "spaces"
  | "work-together"
  | "shared-library"
  | "integrations"
  | "agents"
  | "private-files";

export type MainFeature = {
  id: FeatureId;
  title: string;
  eyebrow: string;
  description: string;
  details: string[];
  availability?: string;
};

const spaces: MainFeature = {
  id: "spaces",
  title: "Spaces",
  eyebrow: "What a Space is",
  description:
    "A Space is one shared workspace for a group — people, chat, tasks, a Library, and Agents in the same place.",
  details: [
    "Everything the group shares lives in the Space.",
    "Members see the same conversations, tasks, and files.",
    "Your private files stay private until you add them.",
  ],
};

const workTogether: MainFeature = {
  id: "work-together",
  title: "Members, Chat, and Tasks",
  eyebrow: "Work together",
  description: "Invite members, chat, and track work in one Space.",
  details: [
    "Invite people and manage access.",
    "Shared, group, and direct messages.",
    "List and board views with assignees, priorities, and due dates.",
  ],
};

const sharedLibrary: MainFeature = {
  id: "shared-library",
  title: "Library",
  eyebrow: "Shared material",
  description: "Add files and references for everyone in the Space.",
  details: [
    "Upload and download Space files.",
    "Search and filter Library items.",
    "Files stay private until you add them.",
  ],
};

const integrations: MainFeature = {
  id: "integrations",
  title: "Integrations",
  eyebrow: "Pilot / coming",
  description:
    "Google Calendar is in pilot. Slack, Notion, and Discord are not generally available.",
  details: [
    "Google Calendar · Pilot",
    "Slack and Notion · Coming",
    "Discord · Coming",
  ],
  availability: "Pilot and coming",
};

const agents: MainFeature = {
  id: "agents",
  title: "Agents",
  eyebrow: "Conditional beta",
  description:
    "Talk with agents that work from the Space context you can access.",
  details: [
    "Uses only content you can access.",
    "Your conversation stays private.",
    "Availability varies during beta.",
  ],
  availability: "Conditional beta",
};

const privateFiles: MainFeature = {
  id: "private-files",
  title: "Private Files",
  eyebrow: "Your file environment",
  description:
    "Browse local and connected storage, then choose what to add to a Space.",
  details: [
    "Local and connected storage.",
    "Search and inspect files.",
    "Track transfers.",
  ],
};

export const mainFeatures = [
  spaces,
  workTogether,
  sharedLibrary,
  integrations,
  agents,
  privateFiles,
];
