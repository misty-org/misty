import {
  HiOutlineArrowsRightLeft,
  HiOutlineBolt,
  HiOutlineBookOpen,
  HiOutlineChatBubbleLeftRight,
  HiOutlineCloud,
  HiOutlineCpuChip,
  HiOutlineFolderOpen,
  HiOutlineMagnifyingGlass,
  HiOutlineSparkles,
  HiOutlineWrenchScrewdriver,
} from "react-icons/hi2";
import type { IconType } from "react-icons";

export type MainFeature = {
  title: string;
  eyebrow: string;
  description: string;
  details: string[];
  imageSrc?: string;
  imageAlt: string;
  characterSrc?: string;
  Icon: IconType;
};

export type FeatureChapter = {
  id: "files" | "space" | "intelligence";
  title: string;
  description: string;
  features: MainFeature[];
};

export const featureChapters: FeatureChapter[] = [
  {
    id: "files",
    title: "Files",
    description: "Browse, find, connect, and move the files your work already depends on.",
    features: [
      {
        title: "Browse",
        eyebrow: "Move through your work",
        description: "Browse local and connected files with flexible views built for everyday work.",
        details: ["Local and cloud files", "Flexible views", "Fast navigation"],
        imageSrc: "/misty-browse.png",
        imageAlt: "Misty file browsing workspace screenshot",
        Icon: HiOutlineFolderOpen,
      },
      {
        title: "Search",
        eyebrow: "Find anything",
        description: "Search across local folders and connected storage without thinking about where something lives.",
        details: ["Unified results", "Provider-aware context", "Fast recall"],
        imageSrc: "/misty-search.png",
        imageAlt: "Misty unified file search screenshot",
        Icon: HiOutlineMagnifyingGlass,
      },
      {
        title: "Remotes",
        eyebrow: "Connect storage",
        description: "Bring cloud storage into the same workspace as the files already on your device.",
        details: ["Connected providers", "Remote paths", "Direct authorization"],
        imageSrc: "/misty-connect.png",
        imageAlt: "Misty connected storage screenshot",
        Icon: HiOutlineCloud,
      },
      {
        title: "Transfers",
        eyebrow: "Move with confidence",
        description: "Keep file movement visible while transfers continue in the background.",
        details: ["Background queue", "Progress states", "Cross-provider movement"],
        imageSrc: "/misty-activity.png",
        imageAlt: "Misty transfer activity screenshot",
        Icon: HiOutlineArrowsRightLeft,
      },
    ],
  },
  {
    id: "space",
    title: "Space",
    description: "Bring people, shared knowledge, and creative tools into the same context.",
    features: [
      {
        title: "Chat",
        eyebrow: "Stay in context",
        description: "Keep the conversation beside the files, ideas, and decisions it belongs to.",
        details: ["Shared conversations", "Space context", "One place to follow"],
        imageAlt: "Misty Space chat feature",
        Icon: HiOutlineChatBubbleLeftRight,
      },
      {
        title: "Library",
        eyebrow: "Keep knowledge close",
        description: "Collect the useful material a Space needs and make it easy for everyone to find again.",
        details: ["Shared knowledge", "Organized context", "Fast discovery"],
        imageAlt: "Misty Space library feature",
        Icon: HiOutlineBookOpen,
      },
      {
        title: "Studio",
        eyebrow: "Shape the workspace",
        description: "Create and configure the tools a Space needs without losing sight of the work.",
        details: ["Purpose-built tools", "Space configuration", "Reusable building blocks"],
        imageAlt: "Misty Space studio feature",
        Icon: HiOutlineWrenchScrewdriver,
      },
    ],
  },
  {
    id: "intelligence",
    title: "Intelligence",
    description: "Turn everything in a Space into useful assistance, repeatable work, and action.",
    features: [
      {
        title: "Agents",
        eyebrow: "Delegate the work",
        description: "Give focused agents clear responsibilities and the context to carry out multi-step tasks.",
        details: ["Space context", "Multi-step tasks", "Reviewable results"],
        imageAlt: "Misty intelligent agents feature",
        Icon: HiOutlineCpuChip,
      },
      {
        title: "Workflows",
        eyebrow: "Repeat without effort",
        description: "Turn recurring work into reusable flows that can run on demand or on a schedule.",
        details: ["Reusable flows", "Flexible triggers", "Visible run history"],
        imageSrc: "/misty-activity.png",
        imageAlt: "Misty intelligent workflows screenshot",
        Icon: HiOutlineBolt,
      },
      {
        title: "Assistant",
        eyebrow: "Meet Mika",
        description: "Ask questions, understand Space context, and take reviewed actions with Mika.",
        details: ["Contextual answers", "Workspace understanding", "Reviewed actions"],
        imageAlt: "Mika, Misty's contextual assistant",
        characterSrc: "/mika.webp",
        Icon: HiOutlineSparkles,
      },
    ],
  },
];

export const mainFeatures = featureChapters.flatMap((chapter) => chapter.features);
