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
    description: "Bring Google Drive, OneDrive, and Dropbox into the same file-management surface as local folders.",
    details: ["Three supported providers", "Remote paths", "Direct authorization"],
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
    description: "Experiment with focused desktop tools and panels that fit the way your files need to be handled.",
    details: ["Experimental catalog", "Installed Extensions", "Workflow add-ons"],
    imageSrc: "/misty-plugins.png",
    imageAlt: "Misty extensions feature screenshot",
    Icon: HiOutlinePuzzlePiece,
  },
  {
    title: "Mika",
    eyebrow: "Ask in context",
    description: "Experiment with Mika to ask questions about the files and workspace already in front of you.",
    details: ["Experimental assistant", "File questions", "Reviewed actions"],
    imageAlt: "Mika experimental assistant feature screenshot",
    Icon: HiOutlineSparkles,
  },
];
