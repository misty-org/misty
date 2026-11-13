/**
 * An engine's environment variables: what its CLI finds in its environment each time Misty
 * starts it, such as a proxy, a region or a feature flag. One engine at a time, picked at the top.
 * A variable whose name looks like a key (KEY, TOKEN, SECRET…) is a secret field that never shows
 * its value again; the rest show and edit their value in place, saving when the field is left.
 */
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FieldError,
  IconButton,
  Input,
  MenuItem,
  SecretField,
  Skeleton,
  SkeletonControl,
  useConfirmDelete,
} from "@/shared/ui";
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
    <DesktopSettingsRow label={variable.name} density="compact">
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

function AddVariable({
  engine,
  onChange,
}: {
  engine: EngineId;
  onChange: (vars: EngineEnvVar[]) => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      onChange(await engineEnvApi.set(engine, name.trim(), value));
      setName("");
      setValue("");
      setError("");
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="grid gap-1 py-3" data-tour="agents-env-add">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Variable name"
          placeholder="NAME"
          className="w-56"
          value={name}
          onChange={(event) => setName(event.target.value.toUpperCase().replace(/\s/g, "_"))}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
        <Input
          aria-label="Variable value"
          placeholder="Value"
          className="min-w-0 flex-1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
        <Button variant="secondary" disabled={!name.trim() || saving} onClick={() => void add()}>
          <Plus />
          Add
        </Button>
      </div>
      <FieldError message={error} />
    </div>
  );
}

/**
 * The variables' first load: one compact row (most engines have none, a few have one) with the
 * value field and its ⋯ at their real sizes.
 */
function VariableRowSkeleton() {
  return (
    <div
      data-setting-label=""
      role="status"
      aria-label="Variables"
      aria-busy="true"
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 py-3"
    >
      <div className="flex h-6 items-center">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex items-center gap-2">
        <SkeletonControl kind="field" className="w-72" />
        <SkeletonControl kind="icon" />
      </div>
    </div>
  );
}

export function EnvironmentSection({ initialEngine = "claude" }: { initialEngine?: EngineId }) {
  const [engine, setEngine] = useState<EngineId>(initialEngine);
  // Per engine, for this session only: the list carries the plain variables' values and names
  // the keychain's secrets, so it is never written to the cache on disk.
  const variables = useCachedResource(`engine-config/env:${engine}`, () =>
    engineEnvApi.list(engine),
  );
  const vars = variables.data;
  const setVars = variables.set;
  const error = variables.error && !vars ? message(variables.error) : "";
  return (
    <Section title="Environment variables">
      <DesktopSettingsRow label="Engine" density="compact">
        <EnginePicker engine={engine} onChange={setEngine} />
      </DesktopSettingsRow>
      {variables.loading ? (
        <VariableRowSkeleton />
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
      <FieldError message={error} />
      <AddVariable key={engine} engine={engine} onChange={setVars} />
    </Section>
  );
}
