import { File, FileText, Folder, Globe, Plus, ScrollText, Terminal, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { SkeletonList, SuggestionItem, SuggestionList, Text } from "@/shared/ui";
import { engineCatalog, mistyEngine, type EngineCatalog } from "../../../engines/enginesApi";
import { matchMentionEntries, mentionIndex, prefetchMentionIndex } from "./mentionFiles";
import {
  matchPrompts,
  PROMPTS_SETTINGS_SECTION,
  promptsFor,
} from "@/features/engine-config/prompts";
import { openSettings, type SettingsSection } from "@/features/settings";
import { applyTrigger, filterItems, mentionOf, triggerAt, type Trigger } from "./composerTriggers";
import { PersonaMakeAgent, personaSuggestions } from "../../../personas/PersonaSuggestions";

interface Suggestion {
  key: string;
  name: string;
  description: string;
  /** What replaces the typed trigger. */
  insert: string;
  icon: "file" | "folder" | "command" | "skill" | "browser" | "prompt" | "new" | "persona";
  /** A catalog persona's id, which can also be made into an agent from the menu. */
  persona?: string;
  /** A command run in the composer instead of inserted. */
  action?: "browser" | "new-prompt";
  /** Where it comes from, shown quietly at the row's end. */
  source?: string;
}

/** Misty's own commands, run in the composer rather than sent. */
const browserCommand: Suggestion = {
  key: "misty:browser",
  name: "browser",
  description: "Do this message's work in Misty's browser",
  insert: "",
  icon: "browser",
  action: "browser",
  source: "Misty",
};

/** Screen and input control for one message on an outside engine (`features/computer-use`). */
const computerCommand: Suggestion = {
  key: "misty:computer",
  name: "computer",
  description: "Let the engine see and use your screen for this message",
  insert: "/computer ",
  icon: "command",
  source: "Misty",
};

const mistyCommands: Suggestion[] = [
  {
    key: "misty:plan",
    name: "plan",
    description: "Switch to Plan and send what follows",
    insert: "/plan ",
    icon: "command",
    source: "Misty",
  },
];

/** Commands Misty runs for an outside engine's chat, since the engine only runs them in its own
 * terminal app. */
const engineChatCommands: Suggestion[] = [
  {
    key: "misty:new",
    name: "new",
    description: "Start a new chat with this agent",
    insert: "/new",
    icon: "command",
    source: "Misty",
  },
  {
    key: "misty:clear",
    name: "clear",
    description: "Start the engine's next turn in a new session",
    insert: "/clear",
    icon: "command",
    source: "Misty",
  },
  {
    key: "misty:resume",
    name: "resume",
    description: "Continue one of the engine's earlier sessions here",
    insert: "/resume",
    icon: "command",
    source: "Misty",
  },
  {
    key: "misty:mcp",
    name: "mcp",
    description: "Manage MCP servers",
    insert: "/mcp",
    icon: "command",
    source: "Misty",
  },
];

const sourceLabel = { builtin: "", user: "Yours", project: "Project" } as const;

/** The `!` menu's last row, which opens Settings on the prompt library. */
const newPrompt: Suggestion = {
  key: "prompt:new",
  name: "New prompt",
  description: "",
  insert: "",
  icon: "new",
  action: "new-prompt",
};

const catalogs = new Map<string, Promise<EngineCatalog>>();

function catalogFor(engine: string, folder: string) {
  const key = `${engine}\n${folder}`;
  let pending = catalogs.get(key);
  if (!pending) {
    pending = engineCatalog(engine, folder).catch(() => ({ commands: [], skills: [] }));
    catalogs.set(key, pending);
    // Commands and skills change rarely; a minute later the next menu reads them again.
    setTimeout(() => catalogs.delete(key), 60_000);
  }
  return pending;
}

async function suggestionsFor(
  trigger: Trigger,
  engine: string,
  folder: string,
): Promise<Suggestion[]> {
  if (trigger.kind === "prompt") {
    const prompts = await promptsFor(folder).catch(() => []);
    return [
      ...matchPrompts(prompts, trigger.query).map((entry) => ({
        key: `prompt:${entry.path}`,
        name: entry.name,
        description: entry.description ?? "",
        insert: entry.content,
        icon: "prompt" as const,
        source: entry.scope === "workspace" ? "Project" : "Yours",
      })),
      newPrompt,
    ];
  }
  const outside = Boolean(engine && engine !== mistyEngine);
  if (trigger.kind === "persona") return personaSuggestions(trigger.query);
  if (trigger.kind === "file") {
    if (!folder) return [];
    const entries = await mentionIndex(folder);
    return matchMentionEntries(entries, folder, trigger.query).map((item) => ({
      key: `file:${item.rel}`,
      name: item.rel,
      description: "",
      insert: mentionOf(item.isDir ? `${item.rel}/` : item.rel),
      icon: item.isDir ? "folder" : "file",
    }));
  }
  const catalog = outside ? await catalogFor(engine, folder) : { commands: [], skills: [] };
  if (trigger.kind === "command") {
    // A command the engine itself offers wins over Misty's of the same name.
    const engineNames = new Set(catalog.commands.map((item) => item.name.toLowerCase()));
    const ownCommands = (outside ? engineChatCommands : []).filter(
      (item) => !engineNames.has(item.name),
    );
    const engineCommands: Suggestion[] = catalog.commands.map((item) => ({
      key: `command:${item.source}:${item.name}`,
      name: item.name,
      description: item.description,
      insert: item.insert,
      icon: "command",
      source: sourceLabel[item.source],
    }));
    return filterItems(
      [
        ...(outside ? [browserCommand, computerCommand] : []),
        ...mistyCommands,
        ...ownCommands,
        ...engineCommands,
      ],
      trigger.query,
    );
  }
  return filterItems(
    catalog.skills.map((item) => ({
      key: `skill:${item.source}:${item.name}`,
      name: item.name,
      description: item.description,
      insert: item.insert,
      icon: "skill" as const,
      source: sourceLabel[item.source],
    })),
    trigger.query,
  );
}

const icons = {
  file: File,
  folder: Folder,
  command: Terminal,
  skill: ScrollText,
  browser: Globe,
  prompt: FileText,
  new: Plus,
  persona: UserRound,
};

const prefixes = { file: "", command: "/", skill: "$", prompt: "!", persona: "#" };

const emptyText = {
  file: "No matching files in this folder",
  command: "No matching commands",
  skill: "No skills found for this engine",
  prompt: "No prompts yet",
  persona: "No matching personas",
};

/**
 * The `@`, `/`, `$` and `!` menus for one composer. `onKeyDown` takes the keys the menu needs while it
 * is open and returns true for them, so the composer doesn't also send or switch modes.
 */
export function useComposerSuggestions(input: {
  text: string;
  setText(text: string): void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  engine: string;
  folder: string;
  /** Runs a command chosen from the menu, such as attaching the browser. */
  onAction?(action: "browser"): void;
}) {
  const [trigger, setTrigger] = useState<Trigger>();
  const [items, setItems] = useState<Suggestion[]>();
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const request = useRef(0);
  const { text, engine, folder, textareaRef } = input;

  useEffect(() => prefetchMentionIndex(folder), [folder]);

  useEffect(() => {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const found = triggerAt(text, caret);
    const id = found ? `${found.start}:${found.kind}` : "";
    if (!found || id === dismissed) {
      setTrigger(undefined);
      return;
    }
    setTrigger(found);
    setSelected(0);
    const ask = ++request.current;
    const timer = setTimeout(
      () =>
        void suggestionsFor(found, engine, folder).then((list) => {
          if (ask === request.current) setItems(list);
        }),
      0,
    );
    return () => clearTimeout(timer);
  }, [text, engine, folder, textareaRef, dismissed]);

  useEffect(() => {
    if (!trigger) setItems(undefined);
  }, [trigger]);

  const choose = (item: Suggestion) => {
    if (!trigger) return;
    if (item.action === "new-prompt") {
      setTrigger(undefined);
      openSettings(PROMPTS_SETTINGS_SECTION as SettingsSection);
      return;
    }
    if (item.action) input.onAction?.(item.action);
    const next = applyTrigger(text, trigger, item.insert);
    input.setText(next.text);
    setTrigger(undefined);
    requestAnimationFrame(() => {
      const area = textareaRef.current;
      area?.focus();
      area?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!trigger) return false;
    const list = items ?? [];
    if (event.key === "Escape") {
      setDismissed(`${trigger.start}:${trigger.kind}`);
      return true;
    }
    if (!list.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((current) => (current + step + list.length) % list.length);
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      choose(list[Math.min(selected, list.length - 1)]);
      return true;
    }
    return false;
  };

  const open = Boolean(trigger);
  const popup = trigger ? (
    <SuggestionList
      className="composer-suggestions"
      aria-label={
        {
          file: "Files",
          command: "Commands",
          skill: "Skills",
          prompt: "Prompts",
          persona: "Personas",
        }[trigger.kind]
      }
    >
      {items === undefined ? (
        <SkeletonList label="Finding matches" rows={3} lines={1} leading="icon" className="p-1" />
      ) : items.length ? (
        items.map((item, index) => (
          <SuggestionItem
            key={item.key}
            selected={index === selected}
            onPointerDown={() => choose(item)}
            onPointerEnter={() => setSelected(index)}
            icon={icons[item.icon]}
            label={
              <>
                {item.action === "new-prompt" ? item.name : `${prefixes[trigger.kind]}${item.name}`}
                {item.description ? (
                  <Text as="span" tone="muted" className="ml-2 inline">
                    {item.description}
                  </Text>
                ) : null}
              </>
            }
            detail={
              item.persona && index === selected ? (
                <PersonaMakeAgent id={item.persona} />
              ) : (
                item.source
              )
            }
          />
        ))
      ) : (
        <p className="px-3 py-2 text-xs text-cream-muted">
          {trigger.kind === "file" && !folder
            ? "Link a folder to this Space to mention its files"
            : emptyText[trigger.kind]}
        </p>
      )}
    </SuggestionList>
  ) : null;

  return { open, popup, onKeyDown };
}
