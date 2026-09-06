import {
  Bot,
  BookOpenText,
  Code2,
  FolderOpen,
  Globe2,
  Inbox,
  Library,
  ListTodo,
  MessageCircle,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  chat: MessageCircle,
  journal: BookOpenText,
  planner: ListTodo,
  library: Library,
  inbox: Inbox,
  agents: Bot,
  files: FolderOpen,
  browser: Globe2,
  code: Code2,
  terminal: TerminalSquare,
};

export function OfficialAppIcon(props: { appId: string; size?: number }) {
  const Icon = icons[props.appId] ?? Code2;
  const size = props.size ?? 38;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px] border border-charcoal-border bg-charcoal-card text-cream-bright"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.7} />
    </span>
  );
}
