import {
  attributeValue,
  countTags,
  hasAttribute,
  jsxOpeningTags,
  literalValues,
} from "./ui_rule_jsx.ts";

export type Counter = (text: string, path: string) => number;

function exactNames(names: readonly string[]): RegExp {
  return new RegExp(`^(?:${names.join("|")})$`);
}

const titledByName = /^(?:iframe|embed|object|webview|svg|title|link|meta|style)$/;

const titleForwarding = exactNames([
  "Button",
  "IconButton",
  "Pressable",
  "NavIslandItem",
  "MenuItem",
  "ContextMenuAction",
  "MenuCheckItem",
  "MenuRadioItem",
  "MenuSubmenu",
  "MenuTrigger",
  "DropdownMenuItem",
  "DropdownMenuSubTrigger",
  "ContextMenuItem",
  "ContextMenuSubTrigger",
  "ListRowButton",
  "Badge",
  "Input",
  "Textarea",
  "Label",
  "Toggle",
  "ToggleGroupItem",
  "SegmentedControlItem",
  "Checkbox",
  "Switch",
  "SelectItem",
  "SelectTrigger",
  "CommandItem",
  "TableCell",
  "TableHead",
  "Link",
  "NavLink",
]);

export const countNativeTitles: Counter = (text) =>
  countTags(text, /^(?:[a-z][\w-]*|[A-Z][\w.]*)$/, (tag) => {
    const intrinsic = /^[a-z]/.test(tag.name);
    if (intrinsic ? titledByName.test(tag.name) : !titleForwarding.test(tag.name)) return false;
    return /\stitle=/.test(tag.flat);
  });

const legacyVariants = ["default", "outline", "ghost", "toolbar", "link", "destructive", "chip"];
const buttonVariantFns = /\bbuttonVariants\(\s*\{[^}]*\bvariant:\s*["'`]([\w-]+)["'`]/g;

export const countLegacyVariants: Counter = (text, path) => {
  let count = !path.endsWith(".tsx")
    ? 0
    : countTags(text, /^(?:Button|IconButton|MenuTrigger)$/, (tag) =>
        literalValues(attributeValue(tag, "variant")).some(
          (value) =>
            legacyVariants.includes(value) || (value === "overlay" && tag.name === "Button"),
        ),
      );
  for (const match of text.matchAll(buttonVariantFns)) {
    if (legacyVariants.includes(match[1]) || match[1] === "overlay") count += 1;
  }
  return count;
};

const legacyButtonSizes = ["xs", "default", "chip"];
const legacyIconButtonSizes = ["2xs", "xs", "lg"];

export const countLegacySizes: Counter = (text) =>
  countTags(text, /^(?:Button|IconButton|MenuTrigger)$/, (tag) => {
    const old = tag.name === "Button" ? legacyButtonSizes : legacyIconButtonSizes;
    return literalValues(attributeValue(tag, "size")).some((value) => old.includes(value));
  });

const rawMenuRows = /^(?:DropdownMenu|ContextMenu)(?:Item|CheckboxItem|RadioItem|SubTrigger)$/;
const menuRowNames = new RegExp(
  "^(?:MenuItem|ContextMenuAction|MenuSubmenu|MenuCheckItem|MenuRadioItem" +
    "|DropdownMenu\\w+|ContextMenu\\w+)$",
);

export const countRawMenuRows: Counter = (text) =>
  countTags(text, menuRowNames, (tag) => rawMenuRows.test(tag.name));

const listRows =
  /^(?:MenuItem|ContextMenuAction|MenuSubmenu|MenuCheckItem|MenuRadioItem|SelectItem|CommandItem)$/;

export const countRepeatedMenuIcons: Counter = (text) =>
  countTags(text, listRows, (tag) => {
    if (!/^\{\s*[A-Z]\w*\s*\}$/.test(attributeValue(tag, "icon") ?? "")) return false;
    const before = text.slice(Math.max(0, tag.start - 200), tag.start);
    return /\.map\(\s*(?:\([^()]*\)|\w+)\s*=>\s*\(?\s*$/.test(before);
  }) + countRepeatedOptionIcons(text);

const optionMap =
  /\.map\(\s*(?:\([^()]*\)|\w+)\s*(?::\s*[\w<>[\]]+\s*)?=>\s*\(\{((?:(?!\.map\(|\}\))[\s\S]){0,500}?)\}\)/g;
function countRepeatedOptionIcons(text: string): number {
  let count = 0;
  for (const match of text.matchAll(optionMap))
    if (/\bicon:\s*[A-Z]\w*\s*(?:[,}]|$)/.test(match[1] ?? "")) count += 1;
  return count;
}

function iconNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Z]/.test(name)) names.add(name);
    }
  }
  return names;
}
const iconLike = /(?:Icon|Avatar|Mark|Logo|Glyph)$|^(?:img|svg|AssetIcon)$/;

export const countLeadingRowIcons: Counter = (text) => {
  const icons = iconNames(text);
  const rows = jsxOpeningTags(text, /^(?:ListRow|ListRowButton)$/).filter(
    (tag) => !tag.selfClosing && !hasAttribute(tag, "label"),
  );
  let count = 0;
  for (const row of rows) {
    const first = /^(?:\s|\{\s*\})*<([A-Za-z][\w.]*)/.exec(text.slice(row.end, row.end + 600));
    if (!first) continue;
    if (icons.has(first[1]) || iconLike.test(first[1])) count += 1;
  }
  return count;
};

const barElement =
  /^(?:Toolbar|ToolbarGroup|ActionBar|PageHeader|header|footer|nav|menu|DialogFooter|SheetFooter)$/;

export const countRaggedWraps: Counter = (text) => {
  let count = 0;
  for (const tag of jsxOpeningTags(text)) {
    if ((tag.name === "Toolbar" || tag.name === "ToolbarGroup") && hasAttribute(tag, "wrap")) {
      const value = attributeValue(tag, "wrap");
      if (value !== "{false}") {
        count += 1;
        continue;
      }
    }
    if (!/(?<![\w-])flex-wrap(?:-reverse)?(?![\w-])|flexWrap:\s*["']wrap/.test(tag.raw)) continue;
    if (
      barElement.test(tag.name) ||
      literalValues(attributeValue(tag, "role")).some((role) =>
        ["toolbar", "group", "menubar", "tablist"].includes(role),
      ) ||
      /(?<![\w-])(?:items-(?:center|baseline)|justify-(?:between|end))(?![\w-])/.test(tag.raw)
    ) {
      count += 1;
    }
  }
  return count;
};

const actionLabels = /^(?:Button|AlertDialogAction|AlertDialogCancel|DialogClose|MenuItem)$/;
const statusText = />\s*(?:Saved|Done|Copied|Updated|Success|Applied)!?\s*</g;
const statusString = /["'`](?:Saved|Copied|Success|Saved!|Copied!)["'`]/g;

export const countStatusWords: Counter = (text) => {
  let count = 0;
  for (const match of text.matchAll(statusText)) {
    let open = text.lastIndexOf("<", match.index);
    while (open > 0 && /^<[A-Za-z][^<>]*\/>/.test(text.slice(open)))
      open = text.lastIndexOf("<", open - 1);
    const name = /^<([A-Za-z][\w.]*)/.exec(text.slice(open))?.[1] ?? "";
    if (!actionLabels.test(name)) count += 1;
  }
  return count + (text.match(statusString)?.length ?? 0);
};

function lucideNames(text: string): string[] {
  const names = new Set(["Icon"]);
  for (const found of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
    for (const part of found[1]!.split(",")) {
      const local = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (local && /^[A-Z]\w*$/.test(local) && !local.startsWith("type ")) names.add(local);
    }
  }
  return [...names];
}

export const countIconSizing: Counter = (text) =>
  countTags(text, exactNames(lucideNames(text)), (tag) => {
    if (hasAttribute(tag, "size") || hasAttribute(tag, "strokeWidth")) return true;
    const classes = attributeValue(tag, "className") ?? "";
    return /(?<![\w-])(?:[a-z-]+:)*!?(?:size|h|w)-(?:\d|\[)/.test(classes);
  });

export const countButtonSizing: Counter = (text) =>
  countTags(text, /^(?:Button|IconButton|MenuTrigger)$/, (tag) => {
    const classes = attributeValue(tag, "className") ?? "";
    return /(?<![\w-])(?:[a-z-]+:)*!?(?:size|h|w|min-h|min-w|p[trblxy]?)-(?:\d|\[|px\b)/.test(
      classes,
    );
  });

export const countSmallIconButtons: Counter = (text) =>
  countTags(text, /^IconButton$/, (tag) => {
    if (!literalValues(attributeValue(tag, "size")).includes("sm")) return false;
    const label = attributeValue(tag, "label") ?? "";
    return !/^["'`{]*\s*[`"']?(?:Close|Remove|Clear|Dismiss|Delete|Cancel)\b/.test(label);
  });
