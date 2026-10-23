import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { spacesApi } from "@/api/spaces/api";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FileInput,
} from "@/shared/ui";
import { createSpaceItem, type SpaceCreateKind } from "../../home/createSpaceItem";

const createOptions: { kind: SpaceCreateKind; label: string }[] = [
  { kind: "chat", label: "Chat" },
  { kind: "note", label: "Note" },
  { kind: "drawing", label: "Drawing" },
  { kind: "file", label: "File" },
  { kind: "code", label: "Code" },
];

export function SpaceCreateMenu({
  spaceId,
  onError,
}: {
  spaceId: string;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    onError("");
    try {
      for (const file of files) await spacesApi.uploadLibraryBlob(spaceId, file, file.name);
    } catch (cause) {
      onError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Couldn't add that file. Try again.",
      );
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  async function make(kind: SpaceCreateKind) {
    onError("");
    setBusy(true);
    try {
      await createSpaceItem(spaceId, kind, navigate, () => picker.current?.click());
    } catch {
      const label = createOptions.find((option) => option.kind === kind)?.label.toLowerCase();
      onError(`Couldn't make a new ${label ?? "item"}. Try again.`);
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
      <DropdownMenu onOpenChange={() => onError("")}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="New"
            disabled={busy}
            variant="primary"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>New</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-40">
          {createOptions.map((option) => (
            <DropdownMenuItem
              key={option.kind}
              disabled={busy}
              onSelect={() => void make(option.kind)}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
