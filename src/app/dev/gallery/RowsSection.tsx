import {
  Button,
  ConfirmDeleteDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  Text,
  useConfirmDelete,
  type RowState,
} from "@/shared/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { GalleryPane, GalleryRow, GallerySection } from "./GalleryLayout";

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

const sampleRows: ReadonlyArray<{ id: string; label: string; state: RowState }> = [
  { id: "plain", label: "No state", state: { kind: "none" } },
  { id: "working", label: "Agent working on it", state: { kind: "working" } },
  { id: "waiting", label: "Agent waiting on you", state: { kind: "waiting" } },
  { id: "unread", label: "Something unread", state: { kind: "unread" } },
  { id: "recent", label: "Changed a few minutes ago", state: { kind: "time", at: minutesAgo(5) } },
  { id: "older", label: "Changed last week", state: { kind: "time", at: minutesAgo(60 * 24 * 9) } },
  {
    id: "long",
    label: "A very long chat title that runs past the edge of its row and fades out there",
    state: { kind: "time", at: minutesAgo(180) },
  },
];

function RowMenu(props: { onDelete: () => void }) {
  return (
    <>
      <MenuItem icon={Pencil} label="Rename" onSelect={() => {}} />
      <MenuItem icon={Trash2} label="Delete" danger onSelect={props.onDelete} />
    </>
  );
}

export function RowsSection() {
  const [selected, setSelected] = useState("working");
  const { confirm, dialog } = useConfirmDelete();
  const askDelete = (label: string) =>
    void confirm({
      title: `Delete "${label}"?`,
      what: "The chat and its history are deleted. This can't be undone.",
      onConfirm: () => new Promise<void>((resolve) => window.setTimeout(resolve, 800)),
    });
  return (
    <GallerySection title="Rows, empty states and deletes">
      <GalleryRow label="ListRow states">
        <div className="grid w-72 gap-px" role="list" aria-label="Sample chats">
          {sampleRows.map((row) => (
            <div key={row.id} role="listitem">
              <ListRow
                label={row.label}
                state={row.state}
                selected={selected === row.id}
                onOpen={() => setSelected(row.id)}
                menuLabel="Chat actions"
                menu={<RowMenu onDelete={() => askDelete(row.label)} />}
              />
            </div>
          ))}
          <div role="listitem">
            <ListRow label="Disabled row" disabled state={{ kind: "none" }} />
          </div>
        </div>
      </GalleryRow>
      <GalleryRow label="ListRowSkeleton">
        <ListRowSkeleton label="Loading chats" rows={4} state className="w-72" />
      </GalleryRow>
      <GalleryRow label="EmptyState">
        <GalleryPane>
          <EmptyState
            title="No notes yet"
            line="Notes you write here are shared with the Space."
            action={{ label: "New note", icon: Plus, onClick: () => {}, variant: "primary" }}
          />
        </GalleryPane>
      </GalleryRow>
      <GalleryRow label="ErrorState">
        <GalleryPane>
          <ErrorState
            title="Couldn't load the Space"
            line="Check your connection and try again."
            action={{ label: "Try again", onClick: () => {} }}
          />
        </GalleryPane>
      </GalleryRow>
      <ConfirmDeleteRow />
      {dialog}
    </GallerySection>
  );
}

function ConfirmDeleteRow() {
  const { confirm, dialog } = useConfirmDelete();
  const [typedOpen, setTypedOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const ask = async (fails: boolean) => {
    const confirmed = await confirm({
      title: 'Delete "Q3 notes"?',
      what: "It's deleted for everyone in the Space. This can't be undone.",
      onConfirm: () =>
        new Promise<void>((resolve, reject) =>
          window.setTimeout(
            () =>
              fails ? reject(new Error("The server couldn't delete it. Try again.")) : resolve(),
            800,
          ),
        ),
    });
    setResult(`confirm() resolved ${String(confirmed)}`);
  };
  return (
    <GalleryRow label="ConfirmDeleteDialog">
      <Button variant="danger" icon={Trash2} onClick={() => void ask(false)}>
        Delete
      </Button>
      <Button variant="danger" icon={Trash2} onClick={() => void ask(true)}>
        Delete, failing
      </Button>
      <Button variant="secondary" onClick={() => setTypedOpen(true)}>
        Type the name
      </Button>
      {result ? (
        <Text size="meta" tone="muted">
          {result}
        </Text>
      ) : null}
      {dialog}
      <ConfirmDeleteDialog
        open={typedOpen}
        onOpenChange={(open) => {
          setTypedOpen(open);
          if (!open) setTyped("");
        }}
        title='Delete the Space "Studio"?'
        what="Everything in it is deleted for every member. This can't be undone."
        confirmDisabled={typed !== "Studio"}
        onConfirm={() => setTyped("")}
      >
        <Field label="Type Studio to confirm">
          <Input value={typed} onChange={(event) => setTyped(event.target.value)} />
        </Field>
      </ConfirmDeleteDialog>
    </GalleryRow>
  );
}
