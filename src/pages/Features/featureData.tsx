import {
  HiOutlineArrowsRightLeft,
  HiOutlineCircleStack,
  HiOutlineCloud,
  HiOutlineMagnifyingGlass,
  HiOutlinePuzzlePiece,
  HiOutlineSparkles,
} from "react-icons/hi2";
import type { IconType } from "react-icons";

export type MainFeature = {
  title: string;
  eyebrow: string;
  description: string;
  details: string[];
  imageSrc?: string;
  imageAlt: string;
  Icon: IconType;
};

export const mainFeatures: MainFeature[] = [
  {
    title: "Search",
    eyebrow: "Find anything",
    description: "Search local folders and connected storage from one place without thinking about where a file lives.",
    details: ["Unified results", "Provider-aware context", "Fast recall"],
    imageSrc: "/misty-search.png",
    imageAlt: "Misty search feature screenshot",
    Icon: HiOutlineMagnifyingGlass,
  },
  {
    title: "Panels",
    eyebrow: "Work side by side",
    description: "Use multiple panels to compare folders, stage moves, and keep source and destination visible.",
    details: ["Multi-pane workspace", "Compare locations", "Fewer window swaps"],
    imageSrc: "/misty-browse.png",
    imageAlt: "Misty panels feature screenshot",
    Icon: HiOutlineCircleStack,
  },
  {
    title: "Remotes",
    eyebrow: "Connect storage",
    description: "Bring cloud accounts, servers, and remote providers into the same file-management surface.",
    details: ["Cloud providers", "Remote paths", "rclone-backed setup"],
    imageSrc: "/misty-connect.png",
    imageAlt: "Misty remotes feature screenshot",
    Icon: HiOutlineCloud,
  },
  {
    title: "Transfers",
    eyebrow: "Move with confidence",
    description: "Keep file movement visible with transfer progress that continues while you keep working.",
    details: ["Background queue", "Progress states", "Cross-provider movement"],
    imageSrc: "/misty-activity.png",
    imageAlt: "Misty transfers feature screenshot",
    Icon: HiOutlineArrowsRightLeft,
  },
  {
    title: "Extensions",
    eyebrow: "Add tools",
    description: "Extend Misty with focused tools and panels that fit the way your files need to be handled.",
    details: ["Plugin catalog", "Installed tools", "Workflow add-ons"],
    imageSrc: "/misty-plugins.png",
    imageAlt: "Misty extensions feature screenshot",
    Icon: HiOutlinePuzzlePiece,
  },
  {
    title: "AI",
    eyebrow: "Ask in context",
    description: "Use MistyAI to ask questions and reason over the files and workspace already in front of you.",
    details: ["Context-aware help", "File questions", "Action-ready answers"],
    imageAlt: "Misty AI feature screenshot",
    Icon: HiOutlineSparkles,
  },
];
