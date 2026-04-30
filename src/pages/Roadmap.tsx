import { HiOutlineCheck } from "react-icons/hi2";
import { VscCircleFilled } from "react-icons/vsc";

const phases = [
  {
    label: "Shipped",
    status: "done" as const,
    items: [
      "Google Drive & OneDrive integration",
      "Unified file browser",
      "Multi-account support",
      "Misty clipboard",
      "Linux support",
    ],
  },
  {
    label: "In Progress",
    status: "active" as const,
    items: [
      "Dropbox & Box integration",
      "Encrypted transfers",
      "File preview panel",
      "Keyboard shortcut customization",
    ],
  },
  {
    label: "Planned",
    status: "planned" as const,
    items: [
      "S3-compatible storage support",
      "Shared workspaces & team accounts",
      "Mobile companion app",
      "Plugin / extension system",
      "Offline mode with sync queue",
    ],
  },
];

const statusStyles = {
  done: {
    badge: "bg-success/10 text-success border-success/20",
    icon: <HiOutlineCheck className="w-3.5 h-3.5 text-success" />,
    dot: "bg-success",
  },
  active: {
    badge: "bg-primary/10 text-primary border-primary/20",
    icon: <VscCircleFilled className="w-3 h-3 text-primary animate-pulse" />,
    dot: "bg-primary",
  },
  planned: {
    badge: "bg-elevated text-text-muted border-border",
    icon: <VscCircleFilled className="w-3 h-3 text-text-muted" />,
    dot: "bg-text-muted",
  },
};

export default function Roadmap() {
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      <div className="mb-12">
        <h1 className="text-3xl md:text-5xl font-bold text-text mb-4">
          Roadmap
        </h1>
        <p className="text-text-muted leading-relaxed">
          Where Misty is headed. Features move from planned to shipped as
          development progresses.
        </p>
      </div>

      <div className="flex flex-col gap-10">
        {phases.map((phase) => {
          const style = statusStyles[phase.status];
          return (
            <div key={phase.label}>
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border ${style.badge}`}
                >
                  {phase.label}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {phase.items.map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border"
                  >
                    {style.icon}
                    <span className="text-sm text-text">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
