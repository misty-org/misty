export const agentPanelStyles = {
  runningBadge: "text-[11px] font-medium text-muted-foreground",
  errorText: "m-0 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive",
  log: "grid min-h-0 content-start overflow-auto pr-0.5",
  message: "grid min-w-0 gap-1.5 rounded-lg bg-muted/40 p-2.5 text-sm",
  userMessage: "bg-accent text-accent-foreground",
  toolMessage: "bg-muted/60",
  errorMessage: "bg-destructive/10 text-destructive",
  messageTitle: "text-xs font-medium text-foreground",
  messageText:
    "m-0 whitespace-pre-wrap break-words font-[inherit] leading-relaxed text-foreground/90",
  planDetails: "grid min-w-0 gap-2",
  planActions: "flex flex-wrap items-center gap-2",
} as const;
