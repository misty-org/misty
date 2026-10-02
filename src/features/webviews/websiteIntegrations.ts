export const websiteIntegrations = {
  "google-drive": {
    label: "Google Drive",
    category: "Cloud storage",
    description: "Open your files and shared drives.",
  },
  dropbox: {
    label: "Dropbox",
    category: "Cloud storage",
    description: "Browse your Dropbox files and folders.",
  },
  onedrive: {
    label: "OneDrive",
    category: "Cloud storage",
    description: "Open your personal and work files.",
  },
  "google-docs": {
    label: "Google Docs",
    category: "Documents",
    description: "Write and collaborate in your Google documents.",
  },
  "microsoft-word": {
    label: "Microsoft Word",
    category: "Documents",
    description: "Open and edit your Word documents on the web.",
  },
  notion: {
    label: "Notion",
    category: "Notes & Wikis",
    description: "Your pages, team wikis, and Notion workspaces.",
  },
  "microsoft-onenote": {
    label: "Microsoft OneNote",
    category: "Notebooks",
    description: "Keep your OneNote notebooks close at hand.",
  },
  "google-calendar": {
    label: "Google Calendar",
    category: "Calendars",
    description: "Your Google calendars and upcoming events.",
  },
  "outlook-calendar": {
    label: "Outlook Calendar",
    category: "Calendars",
    description: "Plan your time in your Outlook calendars.",
  },
  "microsoft-todo": {
    label: "Microsoft To Do",
    category: "Tasks",
    description: "Your daily lists and Microsoft To Do tasks.",
  },
  todoist: {
    label: "Todoist",
    category: "Tasks",
    description: "Personal tasks and projects in Todoist.",
  },
  trello: {
    label: "Trello",
    category: "Projects & Boards",
    description: "Your Trello boards, cards, and team projects.",
  },
  asana: {
    label: "Asana",
    category: "Projects & Boards",
    description: "Follow your team's work and projects in Asana.",
  },
  jira: {
    label: "Jira Cloud",
    category: "Projects & Boards",
    description: "Your team's Jira issues, projects, and boards.",
  },
} as const;
export type WebsiteIntegrationId = keyof typeof websiteIntegrations;
