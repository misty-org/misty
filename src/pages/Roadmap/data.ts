export type PhaseStatus = "available" | "pilot" | "development";

export interface RoadmapItem {
  title: string;
  description: string;
}

export interface RoadmapPhase {
  label: string;
  status: PhaseStatus;
  items: RoadmapItem[];
}

export const phases: RoadmapPhase[] = [
  {
    label: "Available in beta",
    status: "available",
    items: [
      {
        title: "Shared Spaces",
        description: "Create a Space and manage members.",
      },
      {
        title: "Space Chat",
        description: "Shared, group, and direct messages.",
      },
      {
        title: "Tasks",
        description: "List and board views with assignees and priorities.",
      },
      {
        title: "Library",
        description: "Shared project files and references.",
      },
      {
        title: "Private Files",
        description: "Local and connected files stay private until shared.",
      },
      {
        title: "Public desktop builds",
        description: "Apple Silicon macOS and Windows x64.",
      },
    ],
  },
  {
    label: "Limited pilot",
    status: "pilot",
    items: [
      {
        title: "Space-scoped Mika",
        description: "Limited beta; availability varies.",
      },
      {
        title: "Google Calendar",
        description: "Limited task-publishing pilot.",
      },
      {
        title: "Slack and Notion connections",
        description: "Not generally available.",
      },
      {
        title: "Discord connection",
        description: "Not available yet.",
      },
    ],
  },
  {
    label: "In development",
    status: "development",
    items: [
      {
        title: "Tablet builds",
        description: "No public build yet.",
      },
      {
        title: "Broader integration access",
        description: "Self-service setup and hardening.",
      },
      {
        title: "Beta reliability",
        description: "Accounts, providers, and packaging.",
      },
    ],
  },
];
