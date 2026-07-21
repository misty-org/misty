export interface ChangelogGroup {
  heading: string;
  changes: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  status: "beta" | "released";
  groups: ChangelogGroup[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: "v0.1.0",
    date: "Private beta · July 2026",
    summary: "Spaces for shared project work",
    status: "beta",
    groups: [
      {
        heading: "Space collaboration",
        changes: [
          "Create a Space to keep a project's people, conversations, tasks, and shared resources together",
          "Durable Space Chat with shared conversations and Library references",
          "Invite existing Misty accounts, manage membership, and transfer Space ownership",
        ],
      },
      {
        heading: "Tasks",
        changes: [
          "Create, assign, prioritize, and schedule work with shared task details",
          "Switch between focused list and board views as the project changes",
        ],
      },
      {
        heading: "Library",
        changes: [
          "Collect the useful files and references a Space needs in one curated Library",
          "Upload, preview, find, download, and organize shared resources without turning the Library into another raw file browser",
        ],
      },
      {
        heading: "Beta availability",
        changes: [
          "Access is opening in approved, invite-only cohorts while the Space beta is tested",
          "Mika's permission-scoped Space experience is being tested during the beta",
          "Google Calendar, Slack, and Notion connections are in pilot work; Discord support is coming after configuration and reliability testing",
        ],
      },
    ],
  },
];
