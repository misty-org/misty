// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@misty/ui";
import type { EngineId } from "./engines";
import {
  ClaudeFormSections,
  CodexFormSections,
  FlatModelSection,
  ProviderBasicFields,
  ProviderPresetSections,
} from "./ProviderFormSections";
import { useProviderForm, type ProviderFormValue } from "./use_provider_form";

export type { ProviderFormValue } from "./use_provider_form";

export function ProviderDialog({
  engine,
  title,
  initial,
  channelId,
  hasKey,
  onSubmit,
  onCancel,
}: {
  engine: EngineId;
  title: string;
  initial?: ProviderFormValue;
  channelId?: string;
  hasKey: boolean;
  onSubmit: (value: ProviderFormValue) => void;
  onCancel: () => void;
}) {
  const form = useProviderForm({ engine, initial, channelId, onSubmit });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[86vh] w-145 max-w-[94vw] flex-col gap-4 p-5"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            form.submit();
          }}
        >
          <ProviderPresetSections engine={engine} form={form} />
          <ProviderBasicFields engine={engine} form={form} hasKey={hasKey} />
          <ClaudeFormSections engine={engine} form={form} />
          <FlatModelSection engine={engine} form={form} />
          <CodexFormSections engine={engine} form={form} hasKey={hasKey} />
          <DialogFooter>
            <Button type="button" variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!form.valid}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
