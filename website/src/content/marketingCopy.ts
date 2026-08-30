export interface MarketingCopy {
  home: {
    /** The visible headline rotates through each word; the full title remains available to assistive technology. */
    heroTitle: string;
    heroTitleLead: string;
    heroTitleWords: readonly string[];
    ctaTitle: string;
  };
  pricing: { title: string; description: string };
  download: { title: string; description: string };
  blog: { title: string; description: string };
  changelog: { title: string; description: string };
  roadmap: { title: string; description: string };
  waitlist: { title: string; description: string };
  auth: {
    signInDescription: string;
    forgotDescription: string;
    registerTitle: string;
    registerDescription: string;
    resetDescription: string;
    notFoundDescription: string;
  };
  metadata: Record<string, string>;
}

export const marketingCopy: MarketingCopy = {
  home: {
    heroTitle: "The space for organizing, creating, and collaborating.",
    heroTitleLead: "The space for",
    heroTitleWords: [
      "organizing.",
      "creating.",
      "collaborating.",
      "sharing.",
      "working.",
      "planning.",
      "building.",
    ],
    ctaTitle: "Ready to build your space with Misty?",
  },
  pricing: {
    title: "Start together for free. Upgrade when your work grows.",
    description:
      "Every plan includes Misty’s core collaboration experience. Choose a plan based on how many Spaces you need and how much you use AI agents.",
  },
  download: {
    title: "Get Misty for your desktop.",
    description:
      "The current beta download is 44 MB on macOS and 70 MB on Windows, with Browser included.",
  },
  blog: {
    title: "Notes on building Misty.",
    description:
      "What we’re building, what changed our minds, and where the product is heading.",
  },
  changelog: {
    title: "What shipped, and when.",
    description: "Every release of Misty, with the changes that came with it.",
  },
  roadmap: {
    title: "What we’re building next.",
    description:
      "What’s available in beta today, what’s in pilot, and what’s still planned.",
  },
  waitlist: {
    title: "Join Misty",
    description:
      "Sign in to join your group and start working together in one shared Space.",
  },
  auth: {
    signInDescription: "Sign in to pick up where you left off in Misty.",
    forgotDescription:
      "Enter your email and we’ll send you a link to reset your password.",
    registerTitle: "Create an account",
    registerDescription: "Sign up to get started with Misty.",
    resetDescription: "Choose a new password for your Misty account.",
    notFoundDescription:
      "That page doesn’t exist. Check the link, or head back to the homepage.",
  },
  metadata: {
    home: "Misty is a fast, lightweight workspace with built-in apps for organizing, creating, and collaborating.",
    pricing:
      "Compare Misty Basic, Pro, and Max plans by Space limits, AI agent usage, and monthly or annual pricing.",
    download:
      "Download the Misty public beta for macOS and Windows. Both current downloads are under 100 MB with Browser included.",
    blog: "Notes from the team building Misty — what we’re making, what changed our minds, and what’s next.",
    changelog:
      "Every Misty release and the changes that shipped with it, newest first.",
    roadmap:
      "What’s available in the Misty beta today, what’s in pilot, and what’s still planned.",
    waitlist:
      "Sign in to Misty and join your group in one shared Space for files, conversations, tools, tasks, and Agents.",
  },
};
