import { useEffect, useState, type FormEvent } from "react";
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
  Input,
  Label,
} from "@misty/ui";
import { spacesApi } from "../api/api";
import type { SpaceIntegration } from "../api/dto/entities";
import { accessChoices, accessFor, type AccessChoice } from "./integration_access";

export function AddIntegrationDialog(props: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (integration: SpaceIntegration, token: string) => void;
}) {
  const { open } = props;
  const [name, setName] = useState("");
  const [access, setAccess] = useState<AccessChoice>("read");
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setAccess("read");
    setPrefix("");
    setError("");
  }, [open]);

  const close = () => {
    if (!saving) props.onOpenChange(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const named = name.trim();
    if (!named || saving) return;
    setSaving(true);
    setError("");
    try {
      const keyPrefix = prefix.trim();
      const { token, ...integration } = await spacesApi.createIntegration(props.spaceId, {
        name: named,
        access: accessFor(access),
        ...(keyPrefix ? { key_prefix: keyPrefix } : {}),
      });
      props.onOpenChange(false);
      props.onAdded(integration, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The integration couldn't be added.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Add integration</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Name" error={error}>
              <Input
                autoFocus
                maxLength={64}
                value={name}
                onChange={(event) => (setName(event.target.value), setError(""))}
              />
            </Field>
            <div className="grid gap-1.5">
              <Label>Access</Label>
              <ChoiceGroup
                label="Access"
                fill
                value={access}
                onChange={setAccess}
                options={accessChoices}
              />
            </div>
            <Field label="Room key prefix">
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder="Every room"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="quiet" size="lg" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={saving || !name.trim()}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
