import { useEffect, useState } from "react";
import {
  Button,
  ChoiceGroup,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Input,
  ListRow,
  ListRowSkeleton,
  OptionSelect,
} from "@misty/ui";
import { disk, type RenamePreview, type RenameRule } from "@/features/files";
import { countText, messageOf } from "../format";

type RuleKind = RenameRule["kind"];

const ruleKinds = [
  { value: "replace", label: "Replace text" },
  { value: "add", label: "Add text" },
  { value: "format", label: "Format" },
] as const;

const places = [
  { value: "before", label: "Before name" },
  { value: "after", label: "After name" },
];

export function BatchRenameDialog({
  paths,
  onDone,
  onClose,
}: {
  paths: string[];
  onDone(created: string[]): void;
  onClose(): void;
}) {
  const [kind, setKind] = useState<RuleKind>("replace");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [text, setText] = useState("");
  const [base, setBase] = useState("");
  const [start, setStart] = useState("1");
  const [at, setAt] = useState<"before" | "after">("after");
  const [preview, setPreview] = useState<RenamePreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rule: RenameRule =
    kind === "replace"
      ? { kind, find, replace }
      : kind === "add"
        ? { kind, text, at }
        : { kind, base, start: Math.max(0, Number.parseInt(start, 10) || 0), at };
  const ruleKey = JSON.stringify(rule);
  const pathsKey = paths.join("\n");

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void disk.renamePreview(paths, JSON.parse(ruleKey) as RenameRule).then(
        (rows) => live && setPreview(rows),
        (cause) => live && setError(messageOf(cause, "The new names couldn't be worked out.")),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, ruleKey]);

  const changes = preview?.filter((row) => !row.clash && row.from !== row.to).length ?? 0;
  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await disk.renameMany(paths, rule);
      if (result.failed.length) throw new Error(result.failed[0].error);
      onDone(result.created);
    } catch (cause) {
      setError(messageOf(cause, "The items couldn't be renamed."));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="md" layout="scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{`Rename ${countText(paths.length)}`}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4 py-1">
            <ChoiceGroup label="Rule" value={kind} options={ruleKinds} onChange={setKind} fill />
            {kind === "replace" ? (
              <>
                <Field label="Find">
                  <Input autoFocus value={find} onChange={(event) => setFind(event.target.value)} />
                </Field>
                <Field label="Replace with">
                  <Input value={replace} onChange={(event) => setReplace(event.target.value)} />
                </Field>
              </>
            ) : kind === "add" ? (
              <Field label="Text">
                <Input autoFocus value={text} onChange={(event) => setText(event.target.value)} />
              </Field>
            ) : (
              <>
                <Field label="Name">
                  <Input autoFocus value={base} onChange={(event) => setBase(event.target.value)} />
                </Field>
                <Field label="Start numbers at">
                  <Input
                    inputMode="numeric"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </Field>
              </>
            )}
            {kind !== "replace" ? (
              <Field label="Where">
                <OptionSelect
                  value={at}
                  options={places}
                  onValueChange={(value) => setAt(value === "before" ? "before" : "after")}
                />
              </Field>
            ) : null}
            {preview === null ? (
              <ListRowSkeleton label="Working out the new names" lines={2} />
            ) : (
              <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="New names">
                {preview.map((row) => (
                  <li key={row.from}>
                    <ListRow
                      label={row.to || row.from}
                      description={row.clash ? "Name taken: stays as it is" : row.from}
                    />
                  </li>
                ))}
              </ul>
            )}
            {error ? <FieldError message={error} /> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" size="lg" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={busy || changes === 0}
            onClick={() => void apply()}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
