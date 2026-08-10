import { SiDiscord, SiGooglecalendar, SiNotion, SiSlack } from "react-icons/si";

import type { PhaseStatus } from "@/pages/Roadmap/data";

export const capabilities = [
  { name: "Agents", description: "Custom AI on Space context." },
  { name: "Spaces", description: "One shared home for the group." },
  { name: "Chat", description: "Conversation beside the work." },
  { name: "Tasks", description: "Boards, owners, and priorities." },
  { name: "Library", description: "Shared files and references." },
  { name: "Private files", description: "Local and connected, still yours." },
];

export const connections = [
  { name: "Google Calendar", Mark: SiGooglecalendar, status: "In pilot" },
  { name: "Slack", Mark: SiSlack, status: "Coming" },
  { name: "Notion", Mark: SiNotion, status: "Coming" },
  { name: "Discord", Mark: SiDiscord, status: "Coming" },
];

export const roadmapPreview: { status: PhaseStatus; label: string }[] = [
  { status: "available", label: "Shipped" },
  { status: "pilot", label: "In progress" },
  { status: "development", label: "Planned" },
];
