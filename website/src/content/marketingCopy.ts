export interface MarketingCopy {
  home: {
    eyebrow: string;
    /** The headline splits across two lines: lead in full contrast, trail muted. */
    heroTitleLead: string;
    heroTitleTrail: string;
    heroDescription: string;
    ctaTitle: string;
  };
  features: {
    title: string;
    description: string;
    itemDescriptions: readonly string[];
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
    eyebrow: "Public beta · v0.1.0",
    heroTitleLead: "The operating system",
    heroTitleTrail: "for human and agent work.",
    heroDescription:
      "Launch a collaborative, agentic workspace for any group in seconds.",
    ctaTitle: "Move the work out of scattered tabs.",
  },
  features: {
    title: "Everything your group needs, inside one Space.",
    description:
      "Misty keeps collaborative work close together while your private files remain under your control.",
    // Positional: index-matched against `mainFeatures` in src/pages/Features/featureData.tsx.
    // Adding or reordering a feature there requires the same change here.
    itemDescriptions: [
      "One shared Space holds the people, conversations, tasks, Library, and Agents that belong together.",
      "Bring members, conversations, and tasks together so everyone sees the same state of the work.",
      "Collect the files and references your group needs without exposing everything on your device.",
      "Connect the tools your group already uses and keep the useful context close to the work.",
      "Create custom Agents that work from permitted Space context with automatic model routing.",
      "Browse local and connected files privately, then choose exactly what belongs in the Space.",
    ],
  },
  pricing: {
    title: "Start together for free. Upgrade when your work grows.",
    description:
      "Every plan includes Misty’s core collaboration experience. Choose a plan based on how many Spaces you need and how much you use AI agents.",
  },
  download: {
    title: "Get Misty for your desktop.",
    description:
      "Public beta builds for macOS and Windows. Install it, sign in, and your Spaces are there.",
  },
  blog: {
    title: "Notes on building Misty.",
    description:
      "What we’re building, what changed our minds, and where the product is heading.",
  },
  changelog: {
    title: "What shipped, and when.",
    description:
      "Every release of Misty, with the changes that came with it.",
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
    home: "Misty is the operating system for human and agent work. Launch a collaborative, agentic workspace for any group in seconds.",
    features:
      "Keep files, conversations, tasks, tools, and custom Agents together in one shared Misty Space.",
    pricing:
      "Compare Misty Basic, Pro, and Max plans by Space limits, AI agent usage, and monthly or annual pricing.",
    download:
      "Download the Misty public beta for macOS and Windows, and get your Spaces on your desktop.",
    blog: "Notes from the team building Misty — what we’re making, what changed our minds, and what’s next.",
    changelog:
      "Every Misty release and the changes that shipped with it, newest first.",
    roadmap:
      "What’s available in the Misty beta today, what’s in pilot, and what’s still planned.",
    waitlist:
      "Sign in to Misty and join your group in one shared Space for files, conversations, tools, tasks, and Agents.",
  },
};
