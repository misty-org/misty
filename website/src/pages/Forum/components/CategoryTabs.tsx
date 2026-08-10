import { HiOutlineChatBubbleLeftRight } from "react-icons/hi2";
import { VscBug, VscComment, VscLightbulb, VscMegaphone } from "react-icons/vsc";

import type { Category } from "../types";

export type CategoryFilter = Category | "all";

const categories: {
  key: CategoryFilter;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "all",
    label: "All",
    icon: <HiOutlineChatBubbleLeftRight className="w-4 h-4" />,
  },
  {
    key: "general",
    label: "General",
    icon: <VscComment className="w-4 h-4" />,
  },
  {
    key: "feature-requests",
    label: "Feature Requests",
    icon: <VscLightbulb className="w-4 h-4" />,
  },
  {
    key: "bug-reports",
    label: "Bug Reports",
    icon: <VscBug className="w-4 h-4" />,
  },
  {
    key: "show-and-tell",
    label: "Show & Tell",
    icon: <VscMegaphone className="w-4 h-4" />,
  },
];

export default function CategoryTabs({
  active,
  onChange,
}: {
  active: CategoryFilter;
  onChange: (category: CategoryFilter) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-6 scrollbar-hide">
      {categories.map((category) => (
        <button
          key={category.key}
          onClick={() => onChange(category.key)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
            active === category.key
              ? "bg-primary/10 text-primary"
              : "text-text-muted hover:text-text hover:bg-elevated"
          }`}
        >
          {category.icon}
          {category.label}
        </button>
      ))}
    </div>
  );
}
