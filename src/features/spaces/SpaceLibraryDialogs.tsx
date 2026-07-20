import type { Dispatch, FormEventHandler, ReactNode, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SpaceLibraryItem } from "@/spaces/types";

export type LibraryTextDialogState = {
  kind:
    | "create-folder"
    | "rename-folder"
    | "create-group"
    | "rename-memory"
    | "rename-item"
    | "edit-tags";
  title: string;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel?: string;
  secondaryValue?: string;
  itemId?: string;
};

export type LibraryMetadataDialogAction =
  "" | "add_tags" | "remove_tags" | "set_date" | "set_location";
export type LibraryAlbumDialogMode = "" | "create" | "edit";
export type LibraryPersonDialogMode = "" | "create" | "edit";
export type LibraryUnlockScope = "" | "hidden" | "recently_deleted";

type AlbumDialogModel = {
  mode: LibraryAlbumDialogMode;
  name: string;
  description: string;
  coverItemId: string;
  saving: boolean;
  items: SpaceLibraryItem[];
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setCoverItemId: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

type PersonDialogModel = {
  mode: LibraryPersonDialogMode;
  kind: "person" | "pet";
  name: string;
  coverItemId: string;
  saving: boolean;
  items: SpaceLibraryItem[];
  setName: (value: string) => void;
  setCoverItemId: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

type MetadataDialogModel = {
  action: LibraryMetadataDialogAction;
  selectedCount: number;
  tags: string;
  date: string;
  locationName: string;
  latitude: string;
  longitude: string;
  saving: boolean;
  setTags: (value: string) => void;
  setDate: (value: string) => void;
  setLocationName: (value: string) => void;
  setLatitude: (value: string) => void;
  setLongitude: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

type TextDialogModel = {
  state: LibraryTextDialogState | null;
  saving: boolean;
  error: string;
  setState: Dispatch<SetStateAction<LibraryTextDialogState | null>>;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

type UnlockDialogModel = {
  scope: LibraryUnlockScope;
  password: string;
  saving: boolean;
  error: string;
  setPassword: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

export function SpaceLibraryDialogs({
  album,
  person,
  metadata,
  text,
  unlock,
}: {
  album: AlbumDialogModel;
  person: PersonDialogModel;
  metadata: MetadataDialogModel;
  text: TextDialogModel;
  unlock: UnlockDialogModel;
}) {
  return (
    <>
      <AlbumDialog model={album} />
      <PersonDialog model={person} />
      <MetadataDialog model={metadata} />
      <TextDialog model={text} />
      <UnlockDialog model={unlock} />
    </>
  );
}

function AlbumDialog({ model }: { model: AlbumDialogModel }) {
  const title = model.mode === "create" ? "New album" : "Edit album";
  return (
    <Dialog
      open={Boolean(model.mode)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => model.saving && event.preventDefault()}
        onPointerDownOutside={(event) => model.saving && event.preventDefault()}
      >
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Create a focused collection without moving or duplicating its Library items.
            </DialogDescription>
          </DialogHeader>
          <Field label="Name">
            <Input
              autoFocus
              maxLength={120}
              value={model.name}
              onChange={(event) => model.setName(event.target.value)}
            />
          </Field>
          <Field label="Description">
            <Textarea
              className="min-h-24 resize-y"
              maxLength={2000}
              value={model.description}
              onChange={(event) => model.setDescription(event.target.value)}
            />
          </Field>
          {model.mode === "edit" && model.items.length > 0 ? (
            <Field label="Cover">
              <LibrarySelect
                value={model.coverItemId}
                onChange={model.setCoverItemId}
                label="Album cover"
                options={[
                  ["", "Automatic"],
                  ...model.items.map((item) => [item.id, item.display_name] as [string, string]),
                ]}
              />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving || !model.name.trim()}>
              {model.saving ? "Saving…" : model.mode === "create" ? "Create album" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PersonDialog({ model }: { model: PersonDialogModel }) {
  const subject = model.kind === "pet" ? "pet" : "person";
  const title = model.mode === "create" ? `New ${subject}` : `Edit ${subject}`;
  return (
    <Dialog
      open={Boolean(model.mode)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Name this {subject} so Misty can keep related Library items together.
            </DialogDescription>
          </DialogHeader>
          <Field label="Name">
            <Input
              autoFocus
              maxLength={120}
              value={model.name}
              onChange={(event) => model.setName(event.target.value)}
            />
          </Field>
          {model.mode === "edit" && model.items.length > 0 ? (
            <Field label="Cover">
              <LibrarySelect
                value={model.coverItemId}
                onChange={model.setCoverItemId}
                label={`${title} cover`}
                options={[
                  ["", "Automatic"],
                  ...model.items.map((item) => [item.id, item.display_name] as [string, string]),
                ]}
              />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving}>
              {model.saving
                ? "Saving…"
                : model.mode === "create"
                  ? `Create ${subject}`
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MetadataDialog({ model }: { model: MetadataDialogModel }) {
  const title =
    model.action === "add_tags"
      ? "Add tags"
      : model.action === "remove_tags"
        ? "Remove tags"
        : model.action === "set_date"
          ? "Adjust date"
          : "Set location";
  return (
    <Dialog
      open={Boolean(model.action)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {model.selectedCount} selected item{model.selectedCount === 1 ? "" : "s"} will be
              updated.
            </DialogDescription>
          </DialogHeader>
          {model.action === "add_tags" || model.action === "remove_tags" ? (
            <Field label="Tags">
              <Input
                autoFocus
                value={model.tags}
                onChange={(event) => model.setTags(event.target.value)}
                placeholder="travel, family"
              />
            </Field>
          ) : model.action === "set_date" ? (
            <Field label="Date and time">
              <Input
                autoFocus
                type="datetime-local"
                value={model.date}
                onChange={(event) => model.setDate(event.target.value)}
              />
            </Field>
          ) : (
            <div className="grid gap-4">
              <Field label="Place name">
                <Input
                  autoFocus
                  value={model.locationName}
                  onChange={(event) => model.setLocationName(event.target.value)}
                  placeholder="Big Sur"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitude">
                  <Input
                    inputMode="decimal"
                    value={model.latitude}
                    onChange={(event) => model.setLatitude(event.target.value)}
                    placeholder="36.2704"
                  />
                </Field>
                <Field label="Longitude">
                  <Input
                    inputMode="decimal"
                    value={model.longitude}
                    onChange={(event) => model.setLongitude(event.target.value)}
                    placeholder="-121.8079"
                  />
                </Field>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving}>
              {model.saving ? "Saving…" : "Apply changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TextDialog({ model }: { model: TextDialogModel }) {
  const state = model.state;
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && !model.saving && model.close()}>
      <DialogContent className="sm:max-w-md">
        {state ? (
          <form className="grid gap-5" onSubmit={model.submit}>
            <DialogHeader>
              <DialogTitle>{state.title}</DialogTitle>
              <DialogDescription>Save this change to the current Space Library.</DialogDescription>
            </DialogHeader>
            <Field label={state.primaryLabel}>
              <Input
                autoFocus
                maxLength={state.kind === "edit-tags" ? 1000 : 255}
                value={state.primaryValue}
                onChange={(event) =>
                  model.setState((current) =>
                    current ? { ...current, primaryValue: event.target.value } : current,
                  )
                }
              />
            </Field>
            {state.secondaryLabel ? (
              <Field label={state.secondaryLabel}>
                <Input
                  maxLength={120}
                  value={state.secondaryValue ?? ""}
                  onChange={(event) =>
                    model.setState((current) =>
                      current ? { ...current, secondaryValue: event.target.value } : current,
                    )
                  }
                />
              </Field>
            ) : null}
            {model.error ? (
              <p
                className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {model.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  model.saving ||
                  (state.kind !== "edit-tags" && !state.primaryValue.trim()) ||
                  Boolean(state.secondaryLabel && !state.secondaryValue?.trim())
                }
              >
                {model.saving
                  ? "Saving…"
                  : state.kind === "create-folder" || state.kind === "create-group"
                    ? "Create"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UnlockDialog({ model }: { model: UnlockDialogModel }) {
  const title = model.scope === "hidden" ? "Unlock Hidden" : "Unlock Recently Deleted";
  return (
    <Dialog
      open={Boolean(model.scope)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Enter your Misty password to temporarily access this protected collection.
            </DialogDescription>
          </DialogHeader>
          <Field label="Misty password">
            <Input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={model.password}
              onChange={(event) => model.setPassword(event.target.value)}
            />
          </Field>
          {model.error ? (
            <p className="text-sm text-destructive" role="alert">
              {model.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving || !model.password}>
              {model.saving ? "Unlocking…" : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2">
      <span>{label}</span>
      {children}
    </Label>
  );
}

function LibrarySelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  label: string;
}) {
  const selectedValue = value || "__none__";
  return (
    <Select
      value={selectedValue}
      onValueChange={(next) => onChange(next === "__none__" ? "" : next)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem value={id || "__none__"} key={id || "__none__"}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
