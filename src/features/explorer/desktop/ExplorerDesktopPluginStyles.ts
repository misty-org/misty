const pluginTabMenuStyles = {
  menu: "grid w-auto overflow-auto rounded-md bg-popover/95 p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-xl",
  header: "flex h-9 items-center justify-between gap-2 border-b border-border/60 px-2.5 text-sm",
  headerTitle: "flex min-w-0 items-center gap-2",
  headerMeta: "text-xs font-semibold text-muted-foreground",
  iconButton:
    "grid size-7 flex-none place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground",
  searchLabel: "block px-1.5 py-2",
  searchInput:
    "h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring",
  sections: "grid gap-1 py-1",
  section: "grid gap-0.5",
  sectionLabel: "px-2.5 pb-1 pt-1.5 text-[10px] font-bold capitalize text-muted-foreground",
  item: "grid min-h-11 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent bg-transparent px-2.5 py-2 text-left text-muted-foreground hover:bg-transparent hover:text-foreground",
  itemUsable: "border-border/60 bg-secondary text-foreground",
  itemSelected:
    "border-border bg-accent text-accent-foreground shadow-[inset_2px_0_0_var(--foreground)]",
  itemText:
    "grid min-w-0 gap-0.5 [&>small]:min-w-0 [&>small]:overflow-hidden [&>small]:text-ellipsis [&>small]:whitespace-nowrap [&>small]:text-xs [&>small]:font-medium [&>small]:text-muted-foreground [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px]",
  areaPill:
    "rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground",
  areaPillUsable: "border-border bg-accent text-accent-foreground",
  empty: "grid justify-items-center gap-2 px-4 py-5 text-center text-xs text-muted-foreground",
  detail: "grid min-h-0 gap-3 overflow-auto p-3",
  selection:
    "grid min-w-0 gap-1 rounded-md bg-muted/40 px-3 py-2 [&>span]:text-[10px] [&>span]:font-bold [&>span]:capitalize [&>span]:text-muted-foreground [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:font-mono [&>strong]:text-[11px] [&>strong]:font-medium [&>strong]:text-foreground/80",
  footerItem:
    "mt-1 flex h-9 w-full items-center gap-2 rounded-md border-0 border-t border-border/60 bg-transparent px-2.5 text-left text-xs font-semibold text-foreground/80 hover:bg-transparent hover:text-foreground",
} as const;

const extensionsPanelStyles = {
  root: "grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background text-foreground",
  header:
    "flex min-h-[52px] items-center justify-between gap-3 border-b border-border/60 bg-background px-3.5",
  headerTitle:
    "flex min-w-0 items-center gap-2.5 [&_strong]:block [&_strong]:truncate [&_strong]:text-[14px] [&_span]:mt-0.5 [&_span]:block [&_span]:truncate [&_span]:text-xs [&_span]:text-muted-foreground",
  iconButton:
    "grid size-8 flex-none place-items-center rounded-md border border-border/60 bg-secondary text-muted-foreground hover:bg-secondary hover:text-foreground",
  searchLabel: "block border-b border-border/60 px-3 py-2.5",
  searchInput:
    "h-8 w-full rounded-md border border-input bg-secondary px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring",
  body: "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
  list: "flex min-w-0 gap-0 overflow-x-auto border-b border-border/60 bg-background px-2 pt-2",
  item: "relative -mb-px grid min-h-11 w-[164px] shrink-0 grid-cols-[24px_minmax(0,1fr)_22px] items-center gap-2 rounded-t-md border border-transparent border-b-border/60 px-2 py-1.5 text-left text-muted-foreground hover:bg-transparent hover:text-foreground",
  itemSelected: "z-[1] border-border/60 border-b-transparent bg-accent text-accent-foreground",
  itemText:
    "grid min-w-0 gap-0.5 [&>small]:min-w-0 [&>small]:overflow-hidden [&>small]:text-ellipsis [&>small]:whitespace-nowrap [&>small]:text-[11px] [&>small]:font-medium [&>small]:text-muted-foreground [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px]",
  tabClose:
    "grid size-[19px] place-items-center rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground",
  host: "grid min-h-0 content-start gap-3 overflow-auto p-3",
  selectedHeader: "grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5",
  selectedTitle:
    "grid min-w-0 gap-0.5 [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>span]:text-xs [&>span]:text-muted-foreground [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[15px]",
  selectionPill:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground",
  empty:
    "grid justify-items-center gap-2 rounded-md bg-muted/40 px-4 py-5 text-center text-xs text-muted-foreground",
  footerButton:
    "flex h-10 items-center justify-center gap-2 border-0 border-t border-border/60 bg-secondary text-xs font-semibold text-foreground/80 hover:bg-secondary hover:text-foreground",
} as const;

const explorerTrayStyles = {
  triggerWrap: "relative grid place-items-center",
  trigger:
    "relative grid h-[26px] w-[30px] place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground max-[720px]:h-7 max-[720px]:w-8",
  triggerActive: "bg-accent text-accent-foreground",
  badge:
    "pointer-events-none absolute right-0 top-0 grid h-[14px] min-w-[14px] translate-x-1/3 -translate-y-1/4 place-items-center rounded-full bg-destructive px-[3px] text-[9px] font-bold leading-none text-white ring-2 ring-background",
} as const;

const pluginTabHostStyles = {
  header:
    "flex min-h-[92px] items-center justify-between gap-4 border-b border-border/60 bg-background px-4 py-3",
  headerTitle:
    "flex min-w-0 items-center gap-3 [&_strong]:block [&_strong]:truncate [&_strong]:text-[15px] [&_span]:mt-1 [&_span]:block [&_span]:truncate [&_span]:text-xs [&_span]:text-muted-foreground",
  statusPill:
    "shrink-0 rounded-full border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground",
  statusPillUsable: "border-border bg-secondary text-foreground",
  body: "grid min-h-full content-start gap-3 overflow-auto bg-background p-4 text-foreground",
  panel: "grid gap-3 rounded-lg bg-card p-3.5 shadow-xs inset-ring-1 inset-ring-foreground/10",
  panelHeader:
    "flex items-center justify-between gap-3 [&_h3]:m-0 [&_h3]:text-[15px] [&_span]:mt-1 [&_span]:block [&_span]:text-xs [&_span]:text-muted-foreground",
  button:
    "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-semibold text-foreground disabled:cursor-progress disabled:opacity-60",
  input:
    "min-h-9 min-w-[min(280px,100%)] rounded-md border border-input bg-background px-2.5 text-foreground outline-none focus:border-ring disabled:opacity-60",
  elements: "flex min-h-20 flex-wrap items-center gap-2.5",
  text: "m-0 basis-full text-sm leading-[1.45] text-foreground/85",
  separator: "my-1 w-full basis-full border-0 border-t border-border/60",
  spacing: "h-2 basis-full",
  image:
    "grid min-h-12 min-w-20 place-items-center rounded-md bg-muted/40 text-xs text-muted-foreground",
  loading: "rounded-lg bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground",
  notice:
    "grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm text-foreground/80",
  error: "rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive",
  message: "rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success",
  commands:
    "grid gap-2 rounded-lg bg-card p-3.5 shadow-xs inset-ring-1 inset-ring-foreground/10 [&_h3]:m-0 [&_h3]:text-[15px]",
  commandRow:
    "grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t border-border/60 pt-2 first:border-t-0 first:pt-0 [&_em]:whitespace-nowrap [&_em]:text-xs [&_em]:not-italic [&_em]:text-foreground/80 [&_small]:text-muted-foreground",
  commandLabel: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm",
  empty:
    "grid min-h-full content-center justify-items-center gap-2 bg-background p-6 text-center text-muted-foreground [&_h3]:m-0 [&_h3]:text-foreground [&_p]:m-0",
} as const;

export { pluginTabMenuStyles, extensionsPanelStyles, explorerTrayStyles, pluginTabHostStyles };
