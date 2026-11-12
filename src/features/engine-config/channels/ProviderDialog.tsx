// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Button, Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import type { EngineId } from "./engines";
import {
  ClaudeFormSections,
  CodexFormSections,
  FlatModelSection,
  ProviderBasicFields,
  ProviderPresetSections,
} from "./ProviderFormSections";
import { useProviderForm, type ProviderFormValue } from "./useProviderForm";

export type { ProviderFormValue } from "./useProviderForm";

/** Add or edit one channel. The state lives in useProviderForm and each engine's fields in
 *  ProviderFormSections; this is the dialog around them. */
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
  /** The saved channel being edited. */
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
        className="flex max-h-[86vh] w-[580px] max-w-[94vw] flex-col gap-4 p-5"
      >
        <DialogTitle className="pr-10 text-base">{title}</DialogTitle>
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!form.valid}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
