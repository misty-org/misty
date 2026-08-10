export interface MarketingCopy {
  home: {
    heroTitle: string;
    heroDescription: string;
    heroDescriptionEmphasis: string;
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
    heroTitle: "The operating system for human and agent work.",
    heroDescription: "Launch a collaborative, agentic workspace for any group in seconds.",
    heroDescriptionEmphasis: "collaborative, agentic workspace",
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
    title: "Lorem ipsum dolor sit amet.",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas faucibus mollis interdum.",
  },
  blog: {
    title: "Lorem ipsum dolor sit amet.",
    description:
      "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
  },
  changelog: {
    title: "Lorem ipsum dolor sit amet.",
    description:
      "Sed posuere consectetur est at lobortis. Donec id elit non mi porta gravida.",
  },
  roadmap: {
    title: "Lorem ipsum dolor sit amet.",
    description:
      "Praesent commodo cursus magna, vel scelerisque nisl consectetur et.",
  },
  waitlist: {
    title: "Join Misty",
    description:
      "Sign in to join your group and start working together in one shared Space.",
  },
  auth: {
    signInDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    forgotDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.",
    registerTitle: "Create an account",
    registerDescription: "Sign up to get started with Misty.",
    resetDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    notFoundDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.",
  },
  metadata: {
    home: "Misty is the operating system for human and agent work. Launch a collaborative, agentic workspace for any group in seconds.",
    features:
      "Keep files, conversations, tasks, tools, and custom Agents together in one shared Misty Space.",
    pricing:
      "Compare Misty Basic, Pro, and Max plans by Space limits, AI agent usage, and monthly or annual pricing.",
    download:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis.",
    blog: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
    changelog:
      "Sed posuere consectetur est at lobortis. Donec ullamcorper nulla non metus auctor fringilla.",
    roadmap:
      "Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Cras mattis consectetur purus.",
    waitlist:
      "Sign in to Misty and join your group in one shared Space for files, conversations, tools, tasks, and Agents.",
  },
};
