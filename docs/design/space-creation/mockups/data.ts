import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Briefcase,
  CalendarHeart,
  FlaskConical,
  Gamepad2,
  GraduationCap,
  Home,
  Palette,
  Plane,
  Rocket,
  Square,
  Users,
} from "lucide-react";

/** What a template creates, so the dialog can say so before anything exists. */
export interface TemplateSeed {
  tasks: string[];
  note?: string;
  collections: string[];
  channels: string[];
}

export interface PrototypeTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  suggestedName: string;
  seed: TemplateSeed;
  /** Proposed additions to today's built-in list. */
  proposed?: boolean;
  personal?: boolean;
}

const none: TemplateSeed = { tasks: [], collections: [], channels: [] };

export const builtInTemplates: PrototypeTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Start with an empty Space.",
    icon: Square,
    suggestedName: "",
    seed: none,
  },
  {
    id: "startup",
    name: "Startup",
    description: "Keep an early team aligned around customers and outcomes.",
    icon: Rocket,
    suggestedName: "Startup",
    seed: {
      tasks: ["Define this week's outcome", "Talk to a first user", "Assign owners"],
      note: "Company snapshot",
      collections: ["Product", "Customer Research", "Brand & Pitch"],
      channels: ["Everyone"],
    },
  },
  {
    id: "research",
    name: "Research",
    description: "Collect sources, coordinate work and track outputs.",
    icon: FlaskConical,
    suggestedName: "Research",
    seed: {
      tasks: ["Write the research question", "Collect key sources", "Set the next checkpoint"],
      note: "Research plan",
      collections: ["Papers", "Data", "Outputs"],
      channels: ["Everyone"],
    },
  },
  {
    id: "student-project",
    name: "Student project",
    description: "Organize a class project from brief to delivery.",
    icon: GraduationCap,
    suggestedName: "Class project",
    seed: {
      tasks: ["Agree on the goal", "Divide responsibilities", "Set the first deadline"],
      note: "Project brief",
      collections: ["Research", "Drafts", "Final Deliverables"],
      channels: ["Everyone"],
    },
  },
  {
    id: "creative-team",
    name: "Creative team",
    description: "Move a shared brief through review and delivery.",
    icon: Palette,
    suggestedName: "Creative team",
    seed: {
      tasks: ["Agree on the brief", "Assign initial deliverables", "Set a review date"],
      note: "Creative brief",
      collections: ["Briefs", "Inspiration", "Work in Progress", "Final"],
      channels: ["Everyone"],
    },
  },
  {
    id: "game-development",
    name: "Game development",
    description: "Coordinate a small team around the next playable build.",
    icon: Gamepad2,
    suggestedName: "Game studio",
    seed: {
      tasks: ["Define a playable milestone", "Assign core roles", "Schedule a playtest"],
      note: "Game brief",
      collections: ["Art", "Audio", "Builds & References"],
      channels: ["Everyone"],
    },
  },
  {
    id: "family",
    name: "Family",
    description: "Keep family plans and important material together.",
    icon: Users,
    suggestedName: "Family",
    seed: {
      tasks: [],
      note: "Family notes",
      collections: ["Important documents"],
      channels: ["Everyone"],
    },
  },
  {
    id: "trip",
    name: "Trip",
    description: "Plan a trip together: dates, bookings and the packing list.",
    icon: Plane,
    suggestedName: "Trip",
    proposed: true,
    seed: {
      tasks: ["Pick the dates", "Book travel", "Book a place to stay", "Share the packing list"],
      note: "Itinerary",
      collections: ["Bookings", "Photos"],
      channels: ["Everyone", "Logistics"],
    },
  },
  {
    id: "event",
    name: "Event",
    description: "Run an event from the guest list to the day itself.",
    icon: CalendarHeart,
    suggestedName: "Event",
    proposed: true,
    seed: {
      tasks: ["Set the date and venue", "Send invitations", "Confirm vendors"],
      note: "Run of show",
      collections: ["Contracts", "Inspiration"],
      channels: ["Everyone"],
    },
  },
  {
    id: "client-work",
    name: "Client work",
    description: "Share a project with a client: scope, deliverables and feedback.",
    icon: Briefcase,
    suggestedName: "Client project",
    proposed: true,
    seed: {
      tasks: ["Confirm the scope", "Agree on milestones", "Schedule the kickoff"],
      note: "Statement of work",
      collections: ["Deliverables", "Feedback"],
      channels: ["Everyone", "Client"],
    },
  },
  {
    id: "household",
    name: "Household",
    description: "Share chores, bills and the documents a home runs on.",
    icon: Home,
    suggestedName: "Home",
    proposed: true,
    seed: {
      tasks: ["List recurring bills", "Split weekly chores"],
      note: "House notes",
      collections: ["Warranties & Manuals", "Bills"],
      channels: ["Everyone"],
    },
  },
  {
    id: "book-club",
    name: "Book club",
    description: "Pick the next read, schedule meetups and keep the discussion.",
    icon: BookOpen,
    suggestedName: "Book club",
    proposed: true,
    seed: {
      tasks: ["Vote on the next book", "Schedule the meetup"],
      note: "Reading list",
      collections: ["Notes & Quotes"],
      channels: ["Everyone", "Spoilers"],
    },
  },
];

export const personalTemplates: PrototypeTemplate[] = [
  {
    id: "template-studio",
    name: "Studio launch",
    description: "Saved from Launch room on Oct 2.",
    icon: Rocket,
    suggestedName: "Launch",
    personal: true,
    seed: {
      tasks: ["Write the launch post", "Record the demo", "Line up beta users", "Ship"],
      note: "Launch checklist",
      collections: ["Press kit", "Screenshots"],
      channels: ["Everyone", "Launch"],
    },
  },
  {
    id: "template-weekly",
    name: "Weekly team",
    description: "Saved from Product on Sep 18.",
    icon: Users,
    suggestedName: "Team",
    personal: true,
    seed: {
      tasks: ["Post weekly goals", "Friday demo"],
      note: "Meeting notes",
      collections: ["Specs"],
      channels: ["Everyone", "Standup"],
    },
  },
];

export const existingSpaces = ["Launch room", "Product", "Family"];

/** People you already share a Space with, offered as one-click invites. */
export const knownPeople = [
  { name: "Sam Lee", email: "sam@studio.dev" },
  { name: "Priya Patel", email: "priya@studio.dev" },
  { name: "Alex Kim", email: "alex@studio.dev" },
  { name: "Jordan Diaz", email: "jordan@studio.dev" },
];

export function seedCounts(seed: TemplateSeed): string {
  const parts = [
    seed.tasks.length ? `${seed.tasks.length} task${seed.tasks.length === 1 ? "" : "s"}` : "",
    seed.note ? "1 note" : "",
    seed.collections.length
      ? `${seed.collections.length} collection${seed.collections.length === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing added";
}
