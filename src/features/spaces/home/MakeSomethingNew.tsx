import { FilePenLine, PenLine, Plus, Upload, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { spacesApi } from "../api/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  FileInput,
  MenuItem,
  MenuTrigger,
  itemToneClass,
  itemTones,
  notify,
  type ItemTone,
} from "@/shared/ui";
import { createSpaceItem, type SpaceCreateKind } from "./createSpaceItem";

type Choice = { id: SpaceCreateKind; label: string; icon: LucideIcon; tone: ItemTone };

const choices: Choice[] = [
  { id: "note", label: "Doc", icon: FilePenLine, tone: itemTones.note },
  { id: "drawing", label: "Drawing", icon: PenLine, tone: itemTones.drawing },
  { id: "file", label: "Upload file", icon: Upload, tone: itemTones.document },
];

const failed = (message: string) => notify({ message, tone: "error", id: "space-new" });

/**
 * The page head's New menu: a doc, a drawing or a file for this Space. Upload file opens the
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
  const picker = useRef<HTMLInputElement>(null);

  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) await spacesApi.uploadLibraryBlob(spaceId, file, file.name);
      onCreated();
    } catch (cause) {
      failed(
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
    setBusy(true);
    try {
      await createSpaceItem(spaceId, choice.id, navigate, () => picker.current?.click(), onCreated);
    } catch {
      failed(`Couldn't make a new ${choice.label.toLowerCase()}. Try again.`);
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
        <MenuTrigger label="New" variant="primary" disabled={busy} icon={Plus} />
        <DropdownMenuContent align="end" className="min-w-44">
          {choices
            .filter((choice) => !only || only.includes(choice.id))
            .map((choice) => (
              <MenuItem
                key={choice.id}
                icon={<choice.icon className={itemToneClass(choice.tone)} aria-hidden />}
                label={choice.label}
                onSelect={() => void make(choice)}
              />
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
