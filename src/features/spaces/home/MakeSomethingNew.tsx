import { NotebookText, PenLine, Plus, Upload, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { spacesApi } from "../api/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  ErrorNotification,
  FileInput,
  MenuTrigger,
  cn,
  itemToneClass,
  itemTones,
  type ItemTone,
} from "@/shared/ui";
import { createSpaceItem, type SpaceCreateKind } from "./createSpaceItem";

type Choice = { id: SpaceCreateKind; label: string; icon: LucideIcon; tone: ItemTone };

const choices: Choice[] = [
  { id: "note", label: "Note", icon: NotebookText, tone: itemTones.note },
  { id: "drawing", label: "Drawing", icon: PenLine, tone: itemTones.drawing },
  { id: "file", label: "Upload file", icon: Upload, tone: itemTones.document },
];

/**
 * The page head's New menu: a note, a drawing or a file for this Space. Upload file opens the
 * system picker and adds the files in place, without leaving the page.
 */
export function MakeSomethingNew({
  spaceId,
  onCreated,
  only,
}: {
  spaceId: string;
  onCreated: () => void;
  /** The kinds to offer, when a page makes only some of them; all of them otherwise. */
  only?: readonly SpaceCreateKind[];
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  async function upload(files: File[]) {
    if (!files.length) return;
    setError("");
    setBusy(true);
    try {
      for (const file of files) await spacesApi.uploadLibraryBlob(spaceId, file, file.name);
      onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Couldn't add that file. Try again.",
      );
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  async function make(choice: Choice) {
    setError("");
    setBusy(true);
    try {
      await createSpaceItem(spaceId, choice.id, navigate, () => picker.current?.click(), onCreated);
    } catch {
      setError(`Couldn't make a new ${choice.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FileInput
        ref={picker}
        multiple
        aria-hidden
        tabIndex={-1}
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
      <DropdownMenu>
        <MenuTrigger
          label="New"
          variant="secondary"
          disabled={busy}
          icon={<Plus aria-hidden="true" />}
        />
        <DropdownMenuContent align="end" className="min-w-44">
          {choices
            .filter((choice) => !only || only.includes(choice.id))
            .map((choice) => (
              <DropdownMenuItem key={choice.id} onSelect={() => void make(choice)}>
                <choice.icon className={cn("size-4", itemToneClass(choice.tone))} aria-hidden />
                {choice.label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </>
  );
}
