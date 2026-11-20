import { Import, Plus, Upload, type LucideIcon } from "lucide-react";
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
  spaceMadeKinds,
  type ItemTone,
} from "@misty/ui";
import { createSpaceItem, type SpaceCreateKind } from "./createSpaceItem";
import { importableKinds, importSpaceItem, type ImportableKind } from "./importSpaceItem";

type Choice = { id: SpaceCreateKind; label: string; icon: LucideIcon; tone: ItemTone };

const choices: Choice[] = [
  ...spaceMadeKinds.map(({ kind, label, icon, tone }) => ({ id: kind, label, icon, tone })),
  { id: "file", label: "Upload file", icon: Upload, tone: itemTones.document },
];

const failed = (message: string) => notify({ message, tone: "error", id: "space-new" });

/**
 * The page head's New menu: a doc, a deck, a workbook, a whiteboard or a file for this Space.
 * Upload file opens the system picker and adds the files in place, without leaving the page. On a
 * kind's own page it also brings a file in as one of that kind (a Word file as a doc, a
 * spreadsheet as a workbook) and opens it.
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
  const importer = useRef<HTMLInputElement>(null);
  // A kind's page offers bringing a file in as that kind.
  const importing: ImportableKind | undefined =
    only?.length === 1 && only[0] in importableKinds ? (only[0] as ImportableKind) : undefined;

  async function bringIn(file: File | undefined) {
    if (!file || !importing) return;
    setBusy(true);
    try {
      const href = await importSpaceItem(spaceId, importing, file);
      onCreated();
      navigate(href);
    } catch (cause) {
      failed(
        cause instanceof Error && cause.message
          ? cause.message
          : `Couldn't bring in ${file.name}. Try again.`,
      );
    } finally {
      setBusy(false);
      if (importer.current) importer.current.value = "";
    }
  }

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
      {importing && (
        <FileInput
          ref={importer}
          accept={importableKinds[importing].accept}
          aria-hidden
          tabIndex={-1}
          onChange={(event) => void bringIn(event.target.files?.[0])}
        />
      )}
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
          {importing && (
            <MenuItem
              icon={Import}
              label={importableKinds[importing].label}
              onSelect={() => importer.current?.click()}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
