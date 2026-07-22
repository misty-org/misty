export interface MarketingCopy {
  home: {
    heroTitle: string;
    heroDescription: string;
    proof: string;
    features: readonly { label: string; title: string; description: string }[];
    workflowTitle: string;
    workflowDescription: string;
    workflow: readonly { title: string; description: string }[];
    updatesTitle: string;
    updatesDescription: string;
    ctaTitle: string;
    ctaDescription: string;
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
    heroTitle: "One shared Space for everything your group is building.",
    heroDescription:
      "Keep files, conversations, tasks, tools, and Agents together without forcing a small team into an enterprise stack.",
    proof:
      "Built for small dev teams, student projects, and collaborative groups.",
    features: [
      {
        label: "Spaces",
        title: "Keep the whole project in one place.",
        description:
          "Bring collaborators, conversations, tasks, and shared resources into a Space everyone can follow.",
      },
      {
        label: "Private files",
        title: "Share only what the group needs.",
        description:
          "Browse local and connected files privately, then add the useful material to the shared Space.",
      },
      {
        label: "Agents",
        title: "Build Agents around shared context.",
        description:
          "Create custom Agents that work from the files and conversations each member is allowed to access.",
      },
    ],
    workflowTitle: "Start working together in minutes.",
    workflowDescription:
      "Open a Space, bring in the group, and keep the work moving without stitching together another pile of apps.",
    workflow: [
      {
        title: "Create a Space",
        description:
          "Give the project one home for people, files, conversations, and tools.",
      },
      {
        title: "Invite the group",
        description:
          "Collaborate freely without per-seat limits or separate storage charges.",
      },
      {
        title: "Add Agents",
        description:
          "Use automatic model routing and the shared context already in the Space.",
      },
    ],
    updatesTitle: "Follow what Misty ships next.",
    updatesDescription:
      "Read product notes and see the public roadmap without digging through release threads.",
    ctaTitle: "Move the project out of scattered tabs.",
    ctaDescription:
      "Give your group one Space for the files, conversations, tools, and Agents that move the work forward.",
  },
  features: {
    title: "Everything the project needs, inside one Space.",
    description:
      "Misty keeps collaborative work close together while your private files remain under your control.",
    itemDescriptions: [
      "Bring members, conversations, and tasks together so everyone can see the same project state.",
      "Collect the files and references your group needs without exposing everything on your device.",
      "Connect the tools your group already uses and keep the useful context close to the work.",
      "Create custom Agents that work from permitted Space context with automatic model routing.",
      "Browse local and connected files privately, then choose exactly what belongs in the Space.",
    ],
  },
  pricing: {
    title: "Simple pricing for shared work.",
    description:
      "Free and Pro both include unlimited Spaces, collaborators, custom Agents, and the same automatic model routing. Pro adds more pooled owner storage and over 6× more Hosted AI capacity.",
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
    title: "Request beta access",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae justo sed nisl consequat posuere.",
  },
  auth: {
    signInDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    forgotDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.",
    registerTitle: "Lorem ipsum dolor sit amet.",
    registerDescription:
      "Consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.",
    resetDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    notFoundDescription:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.",
  },
  metadata: {
    home: "Misty gives small dev teams, students, and collaborative groups one shared Space for files, conversations, tools, tasks, and Agents.",
    features:
      "Keep files, conversations, tasks, tools, and custom Agents together in one shared Misty Space.",
    pricing:
      "Compare Misty Free and Pro: unlimited Spaces, collaborators, and custom Agents with pooled owner storage and weekly Hosted AI usage.",
    download:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis.",
    blog: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
    changelog:
      "Sed posuere consectetur est at lobortis. Donec ullamcorper nulla non metus auctor fringilla.",
    roadmap:
      "Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Cras mattis consectetur purus.",
    waitlist:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae justo sed nisl consequat posuere.",
  },
};
