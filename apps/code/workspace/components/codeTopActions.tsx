import { Bot, ListTree, MoreHorizontal, Wand2 } from "lucide-react";
import type { CodeCommand, CodeTopAction } from "./CodeCommandCenter";

interface CodeTopActionsOptions {
  active: boolean;
  menu: "outline" | "actions" | null;
  labels: { outline: string; actions: string; inlineAi: string };
  outlineCommands: CodeCommand[];
  codeActionCommands: CodeCommand[];
  openOutline: () => void;
  openCodeActions: () => void;
  openInlineAi: () => void;
  openMore: () => void;
  closeMenu: () => void;
}

export function codeTopActions(options: CodeTopActionsOptions): CodeTopAction[] {
  return [
    {
      id: "outline",
      label: options.labels.outline,
      icon: <ListTree className="code-status-icon" />,
      disabled: !options.active,
      menu: {
        open: options.menu === "outline",
        onOpenChange: (open) => (open ? options.openOutline() : options.closeMenu()),
        label: "Document outline",
        emptyLabel: "No document symbols in this file.",
        items: options.outlineCommands,
      },
    },
    {
      id: "code-actions",
      label: options.labels.actions,
      icon: <Wand2 className="code-status-icon" />,
      disabled: !options.active,
      menu: {
        open: options.menu === "actions",
        onOpenChange: (open) => (open ? options.openCodeActions() : options.closeMenu()),
        label: "Code actions",
        emptyLabel: "No code actions are available at the cursor.",
        items: options.codeActionCommands,
      },
    },
    {
      id: "inline-ai",
      label: options.labels.inlineAi,
      icon: <Bot className="code-status-icon" />,
      disabled: !options.active,
      run: options.openInlineAi,
    },
    {
      id: "more",
      label: "More Code commands",
      icon: <MoreHorizontal className="code-status-icon" />,
      run: options.openMore,
    },
  ];
}
