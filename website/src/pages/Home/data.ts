import type { PhaseStatus } from "@/pages/Roadmap/data";

export const capabilities = [
  { name: "Notes", description: "A focused place to think." },
  { name: "Planner", description: "Tasks, agenda, and roadmaps." },
  { name: "Browser", description: "Research beside the work." },
  { name: "Files", description: "Local and connected, still yours." },
  { name: "Spaces", description: "Shared context when you need it." },
  { name: "Agents", description: "Help across the workspace." },
];

export const roadmapPreview: { status: PhaseStatus; label: string }[] = [
  { status: "available", label: "Shipped" },
  { status: "pilot", label: "In progress" },
  { status: "development", label: "Planned" },
];
