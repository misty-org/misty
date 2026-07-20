const compareStyles = {
  body: "grid gap-3",
  fields: "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-[640px]:grid-cols-1",
  result: "grid gap-2 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground",
  hash: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground",
  diffShell: "grid gap-2 rounded-lg bg-muted/30 p-2.5",
  diffHeader: "flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm text-foreground",
  diffActions: "flex flex-wrap items-center gap-1.5",
  diffGrid:
    "grid max-h-[min(420px,46vh)] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-auto rounded-md border border-border bg-background text-xs max-[760px]:grid-cols-1",
  diffPane:
    "grid min-w-0 content-start border-r border-border last:border-r-0 max-[760px]:border-r-0 max-[760px]:border-b max-[760px]:last:border-b-0",
  diffPaneTitle:
    "sticky top-0 z-[1] border-b border-border bg-muted px-2.5 py-1.5 font-medium text-foreground",
  diffLine:
    "grid min-h-[24px] grid-cols-[42px_minmax(0,1fr)] gap-2 px-2.5 py-1 font-mono leading-relaxed",
  diffLineNumber: "select-none text-right text-muted-foreground",
  diffText: "min-w-0 whitespace-pre-wrap break-words text-foreground",
  diffSame: "bg-transparent",
  diffAdded: "bg-emerald-500/10",
  diffRemoved: "bg-destructive/10",
  diffChanged: "bg-amber-500/10",
  imageGrid:
    "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 rounded-lg bg-muted/30 p-2.5 max-[760px]:grid-cols-1",
  imagePane: "grid min-w-0 content-start gap-2",
  imageFrame: "grid min-h-[180px] place-items-center overflow-hidden rounded-md bg-background",
  imagePreview: "max-h-[320px] max-w-full object-contain",
  imageMeta:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground",
  rowList: "grid max-h-[min(340px,44vh)] overflow-auto rounded-lg bg-muted/30 p-1.5",
  row: "grid grid-cols-[minmax(0,1fr)_100px_100px_110px] items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground max-[720px]:grid-cols-1",
  rowPath: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  rowMeta: "text-xs text-muted-foreground",
  rowActions: "flex items-center justify-end gap-1 max-[720px]:justify-start",
  empty: "rounded-lg bg-muted/30 p-4 text-center text-sm text-muted-foreground",
  error:
    "rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive",
} as const;

export { compareStyles };
