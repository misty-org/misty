import { MenuItem, MessageActions, SecretField, ShortcutField, Text } from "@/shared/ui";
import { Copy, Pencil, RotateCcw, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function SecretFieldSamples() {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <GalleryRow label="SecretField">
        <SecretField
          label="OpenAI key"
          className="w-60"
          saved={saved}
          onSave={async () => {
            await wait(600);
            setSaved(true);
          }}
          onRemove={async () => {
            await wait(600);
            setSaved(false);
          }}
        />
      </GalleryRow>
      <GalleryRow label="SecretField states">
        <SecretField
          label="Search key"
          className="w-60"
          saved={null}
          onSave={() => {}}
          onRemove={() => {}}
        />
        <SecretField
          label="Composio key"
          className="w-60"
          saved={false}
          error="That key was refused. Check it and paste it again."
          onSave={() => {}}
          onRemove={() => {}}
        />
      </GalleryRow>
    </>
  );
}

function ShortcutFieldSamples() {
  const [newChat, setNewChat] = useState<string | null>("Cmd+N");
  const [search, setSearch] = useState<string | null>(null);
  const conflict = search && search === newChat ? "Already used by New chat" : undefined;
  return (
    <GalleryRow label="ShortcutField">
      <ShortcutField label="New chat" className="w-48" value={newChat} onChange={setNewChat} />
      <ShortcutField
        label="Search"
        className="w-48"
        value={search}
        conflict={conflict}
        onChange={setSearch}
      />
    </GalleryRow>
  );
}

function MessageActionsSamples() {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const rate = (next: "up" | "down") => setRating((current) => (current === next ? null : next));
  return (
    <>
      <GalleryRow label="MessageActions, reply">
        <div data-message className="grid w-96 gap-1">
          <Text size="body" lines={2}>
            A reply from an agent. Its actions sit under it, aligned to its edge.
          </Text>
          <MessageActions
            align="start"
            alwaysVisible
            trailing={<time>2:14 PM</time>}
            actions={[
              { id: "copy", icon: Copy, label: "Copy", shortcut: "⌘C", onSelect: () => wait(200) },
              { id: "retry", icon: RotateCcw, label: "Retry", onSelect: () => {} },
              {
                id: "up",
                icon: ThumbsUp,
                label: "Good answer",
                pressed: rating === "up",
                onSelect: () => rate("up"),
              },
              {
                id: "down",
                icon: ThumbsDown,
                label: "Bad answer",
                pressed: rating === "down",
                onSelect: () => rate("down"),
              },
            ]}
            overflow={<MenuItem icon={Trash2} label="Delete" danger onSelect={() => {}} />}
          />
        </div>
      </GalleryRow>
      <GalleryRow label="MessageActions, on hover">
        <div data-message className="grid w-96 gap-1">
          <Text size="body" className="text-right">
            A message from the person; hover it
          </Text>
          <MessageActions
            align="end"
            actions={[
              { id: "copy", icon: Copy, label: "Copy", onSelect: () => wait(200) },
              { id: "edit", icon: Pencil, label: "Edit", onSelect: () => {} },
            ]}
          />
        </div>
      </GalleryRow>
    </>
  );
}

export function PatternsSection() {
  return (
    <GallerySection title="Secrets, shortcuts and message actions">
      <SecretFieldSamples />
      <ShortcutFieldSamples />
      <MessageActionsSamples />
    </GallerySection>
  );
}
