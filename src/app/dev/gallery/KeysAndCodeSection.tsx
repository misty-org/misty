import {
  Avatar,
  AvatarFallback,
  ChoiceGroup,
  CodeBlock,
  CopyButton,
  Input,
  Kbd,
  Text,
  Textarea,
} from "@/shared/ui";
import { CalendarDays, List } from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

const command = "claude mcp add misty -- misty mcp serve --space notes --mode auto";

/** Shortcut keycaps, copying, code, renaming in place, paragraphs and avatar tones. */
export function KeysAndCodeSection() {
  const [title, setTitle] = useState("Launch plan");
  const [view, setView] = useState<"month" | "agenda">("month");
  return (
    <GallerySection title="Keys and code">
      <GalleryRow label="Kbd">
        <Text size="meta" tone="muted">
          Press <Kbd>⌘K</Kbd> to search
        </Text>
        <Kbd>⇧⌘T</Kbd>
      </GalleryRow>
      <GalleryRow label="Copy button">
        <CopyButton value={command} />
        <CopyButton label="Copy link" size="sm" value={() => "https://example.org/notes"} />
      </GalleryRow>
      <GalleryRow label="Code block">
        <CodeBlock code={command} className="flex-1" />
      </GalleryRow>
      <GalleryRow label="Code block, wrapped">
        <CodeBlock code={command} wrap className="flex-1" />
      </GalleryRow>
      <GalleryRow label="Code field">
        <Textarea
          variant="code"
          aria-label="Launch script"
          defaultValue={"npm install\nnpm run dev -- --port 5173"}
        />
      </GalleryRow>
      <GalleryRow label="Title field">
        <div className="min-w-0 flex-1 px-2">
          <Input
            variant="title"
            aria-label="Page name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      </GalleryRow>
      <GalleryRow label="Paragraph">
        <Text size="body" tone="muted" wrap className="max-w-sm">
          Agents in this Space can read its notes and files. They work on your computer, on your own
          keys, and only take requests from you.
        </Text>
      </GalleryRow>
      <GalleryRow label="Display">
        <Text size="display" weight="semibold" tone="bright">
          128
        </Text>
      </GalleryRow>
      <GalleryRow label="Choice shortcuts">
        <ChoiceGroup
          label="Calendar view"
          value={view}
          onChange={setView}
          options={[
            { value: "month", label: "Month", icon: CalendarDays, shortcut: "⌘1" },
            { value: "agenda", label: "Agenda", icon: List, shortcut: "⌘2" },
          ]}
        />
      </GalleryRow>
      <GalleryRow label="Avatar sizes and tones">
        <Avatar size="xs" shape="tile" tone="blue">
          <AvatarFallback>N</AvatarFallback>
        </Avatar>
        <Avatar shape="tile" tone="teal">
          <AvatarFallback>DS</AvatarFallback>
        </Avatar>
        <Avatar size="xl" shape="tile" tone="violet">
          <AvatarFallback>LP</AvatarFallback>
        </Avatar>
        <Avatar size="xl">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
      </GalleryRow>
    </GallerySection>
  );
}
