/** Example prompts shared by the Templates page and the New task landing. */
export type Template = { name: string; category: string; apps: string[]; schedule?: string };
export const taskTemplates: Template[] = [
  {
    name: "Draft replies to messages waiting on me",
    category: "Ops",
    apps: ["Mail"],
    schedule: "Weekdays at 5pm",
  },
  {
    name: "A morning brief from my calendar and inbox",
    category: "Ops",
    apps: ["Calendar", "Mail"],
    schedule: "Every day at 7am",
  },
  {
    name: "Organize my inbox for the day ahead",
    category: "Ops",
    apps: ["Mail"],
    schedule: "Daily at 7am",
  },
  { name: "Research a topic and build a useful report", category: "Research", apps: ["Journal"] },
  { name: "Turn a listing page into a spreadsheet", category: "Data", apps: ["Files"] },
  {
    name: "Build a prospect list from a company directory",
    category: "Sales",
    apps: ["Browser", "Files"],
  },
  { name: "Compare my options and help me choose", category: "Research", apps: [] },
  {
    name: "Prepare a brief before my next meeting",
    category: "Research",
    apps: ["Calendar", "Journal"],
  },
  {
    name: "Find new roles that match my experience",
    category: "Career",
    apps: ["Browser"],
    schedule: "Weekdays at 9am",
  },
  { name: "Find the best price for an item", category: "Personal", apps: [] },
  { name: "Check a webpage and suggest improvements", category: "Engineering", apps: [] },
  {
    name: "Summarize the updates that matter to me",
    category: "Marketing",
    apps: ["Browser"],
    schedule: "Weekdays at 8am",
  },
  {
    name: "Follow up on messages with no reply",
    category: "Ops",
    apps: ["Mail"],
    schedule: "Weekdays at 8am",
  },
  { name: "Pull decisions out of my meeting notes", category: "Docs", apps: ["Journal"] },
  {
    name: "Check service status before the workday",
    category: "Monitoring",
    apps: ["Browser"],
    schedule: "Every day at 8am",
  },
  {
    name: "Build an interview plan from the role brief",
    category: "Recruiting",
    apps: ["Journal"],
  },
];
export const examples: Template[] = [
  {
    name: "Brief me each morning on the topics I follow",
    category: "Research",
    apps: [],
    schedule: "Daily at 7am",
  },
  {
    name: "Track new releases for my dependencies",
    category: "Engineering",
    apps: ["Code"],
    schedule: "Wednesdays at 9am",
  },
  {
    name: "Watch the status of the services I use",
    category: "Monitoring",
    apps: ["Browser"],
    schedule: "Every day at 8am",
  },
  {
    name: "Send me a weekly project health report",
    category: "Ops",
    apps: ["Code"],
    schedule: "Mondays at 9am",
  },
  {
    name: "Review my dashboards and flag changes",
    category: "Data",
    apps: ["Browser"],
    schedule: "Weekdays at 9am",
  },
  {
    name: "Check my core flows before standup",
    category: "Engineering",
    apps: [],
    schedule: "Weekdays at 8am",
  },
];
export const categories = [
  "All",
  "Ops",
  "Research",
  "Sales",
  "Data",
  "Marketing",
  "Personal",
  "Career",
  "Docs",
  "Engineering",
  "Monitoring",
  "Recruiting",
];

/** The draft an example opens with. */
export const templatePrompt = (template: Template) =>
  `${template.name}. Start by clarifying what I need, use original sources, and prepare ` +
  "a concise result with links. Highlight anything uncertain and leave external changes " +
  "for my review.";
