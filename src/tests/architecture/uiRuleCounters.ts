import {
  attributeValue,
  countTags,
  hasAttribute,
  jsxOpeningTags,
  literalValues,
} from "./uiRuleJsx.ts";

/**
 * The UI rules that need code rather than a regex: they read JSX tags and their attributes.
 *
 * Runs under plain Node with uiRules.ts, so it imports nothing but Node itself.
 */

export type Counter = (text: string, path: string) => number;

/** `^(?:A|B|C)$` from a list of names. */
function exactNames(names: readonly string[]): RegExp {
  return new RegExp(`^(?:${names.join("|")})$`);
}

/** Elements whose `title` is not a tooltip: a frame's title is its accessible name. */
const titledByName = /^(?:iframe|embed|object|webview|svg|title|link|meta|style)$/;

/** Shared components and router links that pass `title` straight to the DOM. */
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
          // overlay is IconButton's own variant for controls over media and the Studio; a
          // Button that wants it is an IconButton.
          (value) =>
            legacyVariants.includes(value) || (value === "overlay" && tag.name === "Button"),
        ),
      );
  for (const match of text.matchAll(buttonVariantFns)) {
    if (legacyVariants.includes(match[1]) || match[1] === "overlay") count += 1;
  }
  return count;
};

/** icon, icon-xs and none are counted by icon-only-button and unsized-button. */
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

/** Raw Radix rows, which skip the shared row's layout, checkmark and state slot. */
export const countRawMenuRows: Counter = (text) =>
  countTags(text, menuRowNames, (tag) => rawMenuRows.test(tag.name));

/**
 * A menu row drawn for each item of a list with one fixed icon (`items.map(… icon={Folder} …)`):
 * the same mark on every row tells nothing apart, so such a list is text alone.
 */
const listRows =
  /^(?:MenuItem|ContextMenuAction|MenuSubmenu|MenuCheckItem|MenuRadioItem|SelectItem|CommandItem)$/;

export const countRepeatedMenuIcons: Counter = (text) =>
  countTags(text, listRows, (tag) => {
    if (!/^\{\s*[A-Z]\w*\s*\}$/.test(attributeValue(tag, "icon") ?? "")) return false;
    // The row is what the map's callback returns, so there is one per item of the list. A menu
    // built per item (each card's own Delete) is one action, not a list.
    const before = text.slice(Math.max(0, tag.start - 200), tag.start);
    return /\.map\(\s*(?:\([^()]*\)|\w+)\s*=>\s*\(?\s*$/.test(before);
  }) + countRepeatedOptionIcons(text);

/**
 * The same list built as options instead of rows (`items.map((item) => ({ value, label,
 * icon: Keyboard }))` for an OptionSelect, a dropdown or a picker): one fixed icon on every
 * option.
 */
const optionMap =
  /\.map\(\s*(?:\([^()]*\)|\w+)\s*(?::\s*[\w<>[\]]+\s*)?=>\s*\(\{((?:(?!\.map\(|\}\))[\s\S]){0,500}?)\}\)/g;
function countRepeatedOptionIcons(text: string): number {
  let count = 0;
  for (const match of text.matchAll(optionMap))
    if (/\bicon:\s*[A-Z]\w*\s*(?:[,}]|$)/.test(match[1] ?? "")) count += 1;
  return count;
}

/** Names imported from lucide-react in this file, plus the usual icon and avatar components. */
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
const iconLike = /(?:Icon|Avatar|Mark|Logo|Glyph)$|^(?:img|svg|AssetIcon|BrandIcon)$/;

/** A list row whose first child element is an icon. The new ListRow has no slot for one. */
export const countLeadingRowIcons: Counter = (text) => {
  const icons = iconNames(text);
  const rows = jsxOpeningTags(text, /^(?:ListRow|ListRowButton)$/).filter(
    (tag) => !tag.selfClosing && !hasAttribute(tag, "label"),
  );
  let count = 0;
  for (const row of rows) {
    // Comments are blanked by now, so a JSX comment is an empty `{ }`.
    const first = /^(?:\s|\{\s*\})*<([A-Za-z][\w.]*)/.exec(text.slice(row.end, row.end + 600));
    if (!first) continue;
    if (icons.has(first[1]) || iconLike.test(first[1])) count += 1;
  }
  return count;
};

/** Bars: elements that hold a row of controls. Chip and attachment clouds don't center. */
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

/** Labels that are buttons, where "Done" is the action rather than a status. */
const actionLabels = /^(?:Button|AlertDialogAction|AlertDialogCancel|DialogClose|MenuItem)$/;
const statusText = />\s*(?:Saved|Done|Copied|Updated|Success|Applied)!?\s*</g;
const statusString = /["'`](?:Saved|Copied|Success|Saved!|Copied!)["'`]/g;

export const countStatusWords: Counter = (text) => {
  let count = 0;
  for (const match of text.matchAll(statusText)) {
    // The tag the word sits in: the nearest opening tag before it that isn't self-closing (an
    // icon before a button's label is not what holds the label).
    let open = text.lastIndexOf("<", match.index);
    while (open > 0 && /^<[A-Za-z][^<>]*\/>/.test(text.slice(open)))
      open = text.lastIndexOf("<", open - 1);
    const name = /^<([A-Za-z][\w.]*)/.exec(text.slice(open))?.[1] ?? "";
    if (!actionLabels.test(name)) count += 1;
  }
  return count + (text.match(statusString)?.length ?? 0);
};

/** The names a file imports from lucide-react, plus `Icon`, the usual name for a passed-in one. */
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

/**
 * An icon drawn at a size or stroke of its own: `<X size={17} />`, `<Icon strokeWidth={1.5} />`,
 * `<Folder className="size-5" />`. The control it sits in gives every glyph one size and stroke.
 */
export const countIconSizing: Counter = (text) =>
  countTags(text, exactNames(lucideNames(text)), (tag) => {
    if (hasAttribute(tag, "size") || hasAttribute(tag, "strokeWidth")) return true;
    const classes = attributeValue(tag, "className") ?? "";
    return /(?<![\w-])(?:[a-z-]+:)*!?(?:size|h|w)-(?:\d|\[)/.test(classes);
  });

/**
 * A shared button or menu trigger sized from outside: a height, width, size or padding class
 * (`size-7`, `h-6`, `px-1`). Its size prop and the bar it sits in decide those.
 */
export const countButtonSizing: Counter = (text) =>
  countTags(text, /^(?:Button|IconButton|MenuTrigger)$/, (tag) => {
    const classes = attributeValue(tag, "className") ?? "";
    return /(?<![\w-])(?:[a-z-]+:)*!?(?:size|h|w|min-h|min-w|p[trblxy]?)-(?:\d|\[|px\b)/.test(
      classes,
    );
  });

/**
 * A small (24px) icon button that isn't an inline closer. Small is for closing, removing or
 * clearing something inside a row or tab; a control in a toolbar or composer is md, the row's
 * height.
 */
export const countSmallIconButtons: Counter = (text) =>
  countTags(text, /^IconButton$/, (tag) => {
    if (!literalValues(attributeValue(tag, "size")).includes("sm")) return false;
    const label = attributeValue(tag, "label") ?? "";
    return !/^["'`{]*\s*[`"']?(?:Close|Remove|Clear|Dismiss|Delete|Cancel)\b/.test(label);
  });
