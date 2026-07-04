const pluginTabMenuStyles = {
  menu:
    "fixed z-[2147483000] grid overflow-auto rounded-[11px] border border-[#323232] bg-[rgba(17,17,17,0.98)] p-1.5 text-[#eeeeee] shadow-[0_18px_42px_rgba(0,0,0,0.48)] backdrop-blur-xl",
  header:
    "flex h-9 items-center justify-between gap-2 border-b border-[#292929] px-2.5 text-sm",
  headerTitle: "flex min-w-0 items-center gap-2",
  headerMeta: "text-xs font-semibold text-[#8f8f8f]",
  searchLabel: "block px-1.5 py-2",
  searchInput:
    "h-8 w-full rounded-lg border border-[#303030] bg-[#0c0c0c] px-2.5 text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777] focus:border-[#686868]",
  sections: "grid gap-1 py-1",
  section: "grid gap-0.5",
  sectionLabel:
    "px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-normal text-[#8f8f8f]",
  item:
    "grid min-h-11 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-transparent bg-transparent px-2.5 py-2 text-left text-[#a8a8a8] hover:bg-[#222222] hover:text-[#f7f7f7]",
  itemUsable:
    "border-[#3d3d3d] bg-[#1a1a1a] text-[#eeeeee]",
  itemSelected:
    "border-[#5a5a5a] bg-[#242424] text-[#ffffff] shadow-[inset_2px_0_0_#8f8f8f]",
  itemText:
    "grid min-w-0 gap-0.5 [&>small]:min-w-0 [&>small]:overflow-hidden [&>small]:text-ellipsis [&>small]:whitespace-nowrap [&>small]:text-xs [&>small]:font-medium [&>small]:text-[#9f9f9f] [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px]",
  areaPill:
    "rounded-full border border-[#303030] px-2 py-1 text-[10px] font-semibold text-[#8f8f8f]",
  areaPillUsable:
    "border-[#5a5a5a] bg-[#2a2a2a] text-[#eeeeee]",
  empty:
    "grid justify-items-center gap-2 px-4 py-5 text-center text-xs text-[#adadad]",
  footerItem:
    "mt-1 flex h-9 w-full items-center gap-2 rounded-lg border-0 border-t border-[#292929] bg-transparent px-2.5 text-left text-xs font-semibold text-[#cfcfcf] hover:bg-[#222222] hover:text-[#f7f7f7]",
} as const;

const extensionsPanelStyles = {
  root:
    "grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[#111111] text-[#eeeeee]",
  header:
    "flex min-h-[52px] items-center justify-between gap-3 border-b border-[#292929] bg-[#101010] px-3.5",
  headerTitle:
    "flex min-w-0 items-center gap-2.5 [&_strong]:block [&_strong]:truncate [&_strong]:text-[14px] [&_span]:mt-0.5 [&_span]:block [&_span]:truncate [&_span]:text-xs [&_span]:text-[#8f8f8f]",
  iconButton:
    "grid size-8 flex-none place-items-center rounded-md border border-[#303030] bg-[#171717] text-[#bdbdbd] hover:bg-[#222222] hover:text-[#f7f7f7]",
  searchLabel: "block border-b border-[#292929] px-3 py-2.5",
  searchInput:
    "h-8 w-full rounded-md border border-[#303030] bg-[#0c0c0c] px-2.5 text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777] focus:border-[#686868]",
  body:
    "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
  list:
    "flex min-w-0 gap-0 overflow-x-auto border-b border-[#292929] bg-[#0d0d0d] px-2 pt-2",
  item:
    "relative -mb-px grid min-h-11 w-[164px] shrink-0 grid-cols-[24px_minmax(0,1fr)_22px] items-center gap-2 rounded-t-md border border-transparent border-b-[#292929] px-2 py-1.5 text-left text-[#a8a8a8] hover:bg-[#1b1b1b] hover:text-[#f7f7f7]",
  itemSelected:
    "z-[1] border-[#3d3d3d] border-b-[#111111] bg-[#111111] text-[#eeeeee] shadow-[0_-1px_0_rgba(255,255,255,0.05)]",
  itemText:
    "grid min-w-0 gap-0.5 [&>small]:min-w-0 [&>small]:overflow-hidden [&>small]:text-ellipsis [&>small]:whitespace-nowrap [&>small]:text-[11px] [&>small]:font-medium [&>small]:text-[#8f8f8f] [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px]",
  tabClose:
    "grid size-[19px] place-items-center rounded-full text-[#8f8f8f] hover:bg-[#2b2b2b] hover:text-[#f7f7f7]",
  host:
    "grid min-h-0 content-start gap-3 overflow-auto p-3",
  selectedHeader:
    "grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5",
  selectedTitle:
    "grid min-w-0 gap-0.5 [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>span]:text-xs [&>span]:text-[#8f8f8f] [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[15px]",
  selectionPill:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-[#303030] bg-[#151515] px-2.5 py-1.5 font-mono text-[11px] text-[#bdbdbd]",
  empty:
    "grid justify-items-center gap-2 rounded-md border border-[#303030] bg-[#151515] px-4 py-5 text-center text-xs text-[#adadad]",
  footerButton:
    "flex h-10 items-center justify-center gap-2 border-0 border-t border-[#292929] bg-[#101010] text-xs font-semibold text-[#cfcfcf] hover:bg-[#1d1d1d] hover:text-[#f7f7f7]",
} as const;

const explorerTrayStyles = {
  triggerWrap: "relative grid place-items-center",
  trigger:
    "relative grid h-[26px] w-[30px] place-items-center rounded-md border-0 bg-transparent p-0 text-[#adadad] hover:bg-[#1d1d1d] hover:text-[#eeeeee] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#adadad] aria-expanded:bg-[#1d1d1d] aria-expanded:text-[#eeeeee] max-[720px]:h-7 max-[720px]:w-8",
  triggerActive: "bg-[#1d1d1d] text-[#eeeeee]",
  badge:
    "pointer-events-none absolute right-0 top-0 grid h-[14px] min-w-[14px] translate-x-1/3 -translate-y-1/4 place-items-center rounded-full bg-[#d83e3e] px-[3px] text-[9px] font-bold leading-none text-white shadow-[0_0_0_2px_#101010]",
} as const;

const pluginTabHostStyles = {
  header:
    "flex min-h-[92px] items-center justify-between gap-4 border-b border-[#292929] bg-[#101010] px-4 py-3",
  headerTitle: "flex min-w-0 items-center gap-3 [&_strong]:block [&_strong]:truncate [&_strong]:text-[15px] [&_span]:mt-1 [&_span]:block [&_span]:truncate [&_span]:text-xs [&_span]:text-[#9f9f9f]",
  statusPill:
    "shrink-0 rounded-full border border-[#363636] px-2.5 py-1.5 text-xs font-semibold text-[#9f9f9f]",
  statusPillUsable: "border-[#565656] bg-[#242424] text-[#eeeeee]",
  body:
    "grid min-h-full content-start gap-3 overflow-auto bg-[#111111] p-4 text-[#eeeeee]",
  panel:
    "grid gap-3 rounded-lg border border-[#303030] bg-[#151515] p-3.5",
  panelHeader:
    "flex items-center justify-between gap-3 [&_h3]:m-0 [&_h3]:text-[15px] [&_span]:mt-1 [&_span]:block [&_span]:text-xs [&_span]:text-[#9f9f9f]",
  button:
    "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[7px] border border-[#3a3a3a] bg-[#242424] px-2.5 py-1.5 text-xs font-semibold text-[#eeeeee] disabled:cursor-progress disabled:opacity-60",
  input:
    "min-h-9 min-w-[min(280px,100%)] rounded-[7px] border border-[#3a3a3a] bg-[#0d0d0d] px-2.5 text-[#eeeeee] outline-none focus:border-[#686868] disabled:opacity-60",
  elements: "flex min-h-20 flex-wrap items-center gap-2.5",
  text: "m-0 basis-full text-sm leading-[1.45] text-[#dddddd]",
  separator: "my-1 w-full basis-full border-0 border-t border-[#303030]",
  spacing: "h-2 basis-full",
  image:
    "grid min-h-12 min-w-20 place-items-center rounded-[7px] border border-[#303030] bg-[#0d0d0d] text-xs text-[#9f9f9f]",
  loading:
    "rounded-lg border border-[#303030] bg-[#101010] px-3 py-2.5 text-sm text-[#9f9f9f]",
  notice:
    "grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[#3a3a3a] bg-[#111111] px-3 py-2.5 text-sm text-[#cfcfcf]",
  error:
    "rounded-lg border border-[#4b3434] bg-[#211414] px-3 py-2.5 text-sm text-[#ffb7b7]",
  message:
    "rounded-lg border border-[#354835] bg-[#142014] px-3 py-2.5 text-sm text-[#bcecbc]",
  commands:
    "grid gap-2 rounded-lg border border-[#303030] bg-[#151515] p-3.5 [&_h3]:m-0 [&_h3]:text-[15px]",
  commandRow:
    "grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t border-[#303030] pt-2 first:border-t-0 first:pt-0 [&_em]:whitespace-nowrap [&_em]:text-xs [&_em]:not-italic [&_em]:text-[#cfcfcf] [&_small]:text-[#8f8f8f]",
  commandLabel: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm",
  empty:
    "grid min-h-full content-center justify-items-center gap-2 bg-[#111111] p-6 text-center text-[#9f9f9f] [&_h3]:m-0 [&_h3]:text-[#eeeeee] [&_p]:m-0",
} as const;

export { pluginTabMenuStyles, extensionsPanelStyles, explorerTrayStyles, pluginTabHostStyles };
