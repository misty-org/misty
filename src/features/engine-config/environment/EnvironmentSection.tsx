import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import {
  DesktopSettingsRow,
  DesktopSettingsRowSkeleton,
  useSettingsSectionAction,
} from "@/features/settings";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Field,
  FieldError,
  IconButton,
  Input,
  MenuItem,
  SecretField,
  useConfirmDelete,
} from "@misty/ui";
import { EnginePicker } from "../channels/ChannelsSection";
import type { EngineId } from "../channels/engines";
import { engineEnvApi, type EngineEnvVar } from "./api";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function PlainValue({
  engine,
  variable,
  onChange,
}: {
  engine: EngineId;
  variable: EngineEnvVar;
  onChange: (vars: EngineEnvVar[]) => void;
}) {
  const [draft, setDraft] = useState(variable.value ?? "");
  const [error, setError] = useState("");
  useEffect(() => setDraft(variable.value ?? ""), [variable.value]);
  const commit = async () => {
    if (draft === (variable.value ?? "")) return;
    try {
      onChange(await engineEnvApi.set(engine, variable.name, draft));
      setError("");
    } catch (failure) {
      setError(message(failure));
    }
  };
  return (
    <div className="grid w-72 gap-1">
      <Input
        aria-label={`${variable.name} value`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
        }}
      />
      <FieldError message={error} />
    </div>
  );
}

function VariableRow({
  engine,
  variable,
  onChange,
}: {
  engine: EngineId;
  variable: EngineEnvVar;
  onChange: (vars: EngineEnvVar[]) => void;
}) {
  const { confirm, dialog } = useConfirmDelete();
  const remove = async () => onChange(await engineEnvApi.remove(engine, variable.name));
  return (
    <DesktopSettingsRow label={variable.name}>
      {variable.secret ? (
        <SecretField
          className="w-72"
          label={variable.name}
          saved
          savedText="Saved in keychain"
          removeWhat={`${variable.name} is removed from this computer.`}
          onSave={async (value) => onChange(await engineEnvApi.set(engine, variable.name, value))}
          onRemove={remove}
        />
      ) : (
        <div className="flex items-start gap-2">
          <PlainValue engine={engine} variable={variable} onChange={onChange} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`${variable.name} actions`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" width="sm">
              <MenuItem
                icon={Trash2}
                label="Remove"
                danger
                onSelect={() =>
                  void confirm({
                    title: `Remove ${variable.name}?`,
                    what: `${variable.name} is removed from this computer.`,
                    confirmLabel: "Remove",
                    onConfirm: remove,
                  })
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {dialog}
    </DesktopSettingsRow>
  );
}

function AddVariableDialog({
  engine,
  onChange,
  onClose,
}: {
  engine: EngineId;
  onChange: (vars: EngineEnvVar[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const add = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      onChange(await engineEnvApi.set(engine, name.trim(), value));
      onClose();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  };
  const submit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void add();
  };
  return (
    <DialogContent size="sm">
      <DialogHeader>
        <DialogTitle>Add a variable</DialogTitle>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        <Field label="Name">
          <Input
            placeholder="NAME"
            value={name}
            onChange={(event) => setName(event.target.value.toUpperCase().replace(/\s/g, "_"))}
            onKeyDown={submit}
          />
        </Field>
        <Field label="Value" error={error}>
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={submit}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button size="lg" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="lg"
          variant="primary"
          disabled={!name.trim() || saving}
          onClick={() => void add()}
        >
          Add
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function EnvironmentSection({ initialEngine = "claude" }: { initialEngine?: EngineId }) {
  const [engine, setEngine] = useState<EngineId>(initialEngine);
  const [adding, setAdding] = useState(false);
  const variables = useCachedResource(`engine-config/env:${engine}`, () =>
    engineEnvApi.list(engine),
  );
  const vars = variables.data;
  const setVars = variables.set;
  const error = variables.error && !vars ? message(variables.error) : "";
  useSettingsSectionAction({
    label: "Add variable",
    icon: Plus,
    showLabel: true,
    onSelect: () => setAdding(true),
  });
  return (
    <>
      <DesktopSettingsRow label="Engine">
        <EnginePicker engine={engine} onChange={setEngine} />
      </DesktopSettingsRow>
      {variables.loading ? (
        <DesktopSettingsRowSkeleton label="Variables" control={["field", "icon"]} />
      ) : (
        (vars ?? []).map((variable) => (
          <VariableRow
            key={`${engine}:${variable.name}`}
            engine={engine}
            variable={variable}
            onChange={setVars}
          />
        ))
      )}
      {error ? (
        <DesktopSettingsRow label="Variables" description={error}>
          {null}
        </DesktopSettingsRow>
      ) : null}
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding ? (
          <AddVariableDialog
            key={engine}
            engine={engine}
            onChange={setVars}
            onClose={() => setAdding(false)}
          />
        ) : null}
      </Dialog>
    </>
  );
}
