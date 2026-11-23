import {
  File,
  FileText,
  Folder,
  Globe,
  Plus,
  ScrollText,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { SkeletonList, SuggestionItem, SuggestionList, Text } from "@misty/ui";
import { mistyEngine } from "../../../engines/engines_api";
import { commandIcon } from "../commands/command_icons";
import { catalogFor, mistyCommandsFor } from "../commands/engine_commands";
import { matchMentionEntries, mentionIndex, prefetchMentionIndex } from "./mention_files";
import { matchPrompts, promptsFor } from "@/features/engine-config/prompts";
import { openAgentsHub } from "../../../hub/agents_hub_store";
import { applyTrigger, filterItems, mentionOf, triggerAt, type Trigger } from "./composer_triggers";
import { PersonaMakeAgent, personaSuggestions } from "../../../personas/PersonaSuggestions";

interface Suggestion {
  key: string;
  name: string;
  description: string;
  insert: string;
  icon: "file" | "folder" | "command" | "skill" | "browser" | "prompt" | "new" | "persona";
  hint?: string;
  origin?: "builtin" | "user" | "project";
  persona?: string;
  action?: "browser" | "new-prompt";
  source?: string;
}

const browserCommand: Suggestion = {
  key: "misty:browser",
  name: "browser",
  description: "Do this message's work in Misty's browser",
  insert: "",
  icon: "browser",
  action: "browser",
  source: "Misty",
};

const computerCommand: Suggestion = {
  key: "misty:computer",
  name: "computer",
  description: "Let the engine see and use your screen for this message",
  insert: "/computer ",
  icon: "command",
  source: "Misty",
};

const sourceLabel = { builtin: "", user: "Yours", project: "Project" } as const;

const newPrompt: Suggestion = {
  key: "prompt:new",
  name: "New prompt",
  description: "",
  insert: "",
  icon: "new",
  action: "new-prompt",
};

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
    const engineNames = new Set(catalog.commands.map((item) => item.name.toLowerCase()));
    const own = mistyCommandsFor(engine, engineNames);
    const ownNames = new Set(own.map((item) => item.name));
    const ownCommands: Suggestion[] = own.map((item) => ({
      key: `misty:${item.name}`,
      name: item.name,
      description: item.description,
      insert: `/${item.name}${item.hint ? " " : ""}`,
      hint: item.hint,
      icon: "command",
      origin: "builtin",
      source: "Misty",
    }));
    const engineCommands: Suggestion[] = catalog.commands
      .filter((item) => !ownNames.has(item.name.toLowerCase()))
      .map((item) => ({
        key: `command:${item.source}:${item.name}`,
        name: item.name,
        description: item.description,
        insert: item.insert,
        hint: item.argumentHint,
        icon: "command",
        origin: item.source,
        source: sourceLabel[item.source],
      }));
    return filterItems(
      [...(outside ? [browserCommand, computerCommand] : []), ...ownCommands, ...engineCommands],
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

const shownLists = new Map<string, Suggestion[]>();
const MOST_SHOWN_LISTS = 40;
const listKey = (trigger: Trigger, engine: string, folder: string) =>
  `${trigger.kind}\n${trigger.query}\n${engine}\n${folder}`;

function rememberList(key: string, list: Suggestion[]) {
  shownLists.delete(key);
  shownLists.set(key, list);
  if (shownLists.size > MOST_SHOWN_LISTS) shownLists.delete(shownLists.keys().next().value!);
}

const icons = {
  file: File,
  folder: Folder,
  skill: ScrollText,
  browser: Globe,
  prompt: FileText,
  new: Plus,
  persona: UserRound,
};

function iconOf(item: Suggestion): LucideIcon {
  if (item.icon === "command") return commandIcon(item.name, item.origin);
  return icons[item.icon];
}

const prefixes = { file: "", command: "/", skill: "$", prompt: "!", persona: "#" };

const emptyText = {
  file: "No matching files in this folder",
  command: "No matching commands",
  skill: "No skills found for this engine",
  prompt: "No prompts yet",
  persona: "No matching templates",
};

export function useComposerSuggestions(input: {
  text: string;
  setText(text: string): void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  engine: string;
  folder: string;
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
    const key = listKey(found, engine, folder);
    const known = shownLists.get(key);
    if (known) setItems(known);
    const ask = ++request.current;
    const timer = setTimeout(
      () =>
        void suggestionsFor(found, engine, folder).then((list) => {
          rememberList(key, list);
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
      openAgentsHub("prompts");
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
      className={
        "absolute -right-3 bottom-full -left-3 z-[var(--stack-overlay)] mb-4.5 max-h-70 " +
        "overflow-y-auto"
      }
      aria-label={
        {
          file: "Files",
          command: "Commands",
          skill: "Skills",
          prompt: "Prompts",
          persona: "Templates",
        }[trigger.kind]
      }
    >
      {items === undefined ? (
        <SkeletonList
          label="Finding matches"
          rows={3}
          lines={1}
          leading="icon"
          rowClassName="gap-2 px-2"
          className="gap-0 p-1"
        />
      ) : items.length ? (
        items.map((item, index) => (
          <SuggestionItem
            key={item.key}
            selected={index === selected}
            onPointerDown={() => choose(item)}
            onPointerEnter={() => setSelected(index)}
            icon={iconOf(item)}
            label={
              <>
                {item.action === "new-prompt" ? item.name : `${prefixes[trigger.kind]}${item.name}`}
                {item.hint ? (
                  <Text as="span" tone="muted" className="ml-1 inline">
                    {item.hint}
                  </Text>
                ) : null}
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
        <Text size="meta" bare as="p" tone="muted" className="px-3 py-2">
          {trigger.kind === "file" && !folder
            ? "Link a folder to this Space to mention its files"
            : emptyText[trigger.kind]}
        </Text>
      )}
    </SuggestionList>
  ) : null;

  return { open, popup, onKeyDown };
}
