import type { BatchRenameCaseMode } from "@/models/types/features/explorer/desktop/ExplorerBatchRenameDialog";
export type { BatchRenameCaseMode } from "@/models/types/features/explorer/desktop/ExplorerBatchRenameDialog";
import type { BatchRenameOptions } from "@/models/interfaces/features/explorer/desktop/ExplorerBatchRenameDialog";
export type { BatchRenameOptions } from "@/models/interfaces/features/explorer/desktop/ExplorerBatchRenameDialog";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { Button } from "@/ui";
import { Checkbox } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { validateBatchRenameItems, useExplorerStore } from "@/stores/explorer";
import type { ExplorerBatchRenameItem, ExplorerDialogState } from "@/stores/explorer";

const dialogChromeClass =
  "flex max-h-[min(760px,calc(100vh-48px))] w-[min(720px,calc(100vw-48px))] max-w-none flex-col overflow-hidden bg-popover p-0 text-popover-foreground";
const dialogWideClass = "w-[min(760px,calc(100vw-48px))]";
const fieldClass = "grid gap-1.5 text-xs font-medium text-muted-foreground";
const controlsClass = "grid grid-cols-4 gap-3 border-b border-border p-4 max-[820px]:grid-cols-2";
const toggleClass =
  "flex min-h-9 items-center gap-2 rounded-md bg-muted/50 px-3 text-xs font-medium text-foreground";
const listClass = "min-h-0 overflow-auto px-4 py-3";
const rowClass =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-border py-2.5 text-xs last:border-0";
const rowInvalidClass = "rounded-md border border-destructive/25 bg-destructive/10 px-2";

function batchRenameItemKey(item: ExplorerBatchRenameItem): string {
  return `${item.paneId}:${item.entryId}`;
}

function applyBatchRenameCase(value: string, mode: BatchRenameCaseMode): string {
  if (mode === "lower") return value.toLocaleLowerCase();
  if (mode === "upper") return value.toLocaleUpperCase();
  if (mode === "title") {
    return value
      .toLocaleLowerCase()
      .replace(
        /(^|[\s._-])([a-z])/g,
        (_match, boundary: string, character: string) =>
          `${boundary}${character.toLocaleUpperCase()}`,
      );
  }
  return value;
}

function previewBatchRenameItem(
  item: ExplorerBatchRenameItem,
  index: number,
  options: BatchRenameOptions,
): ExplorerBatchRenameItem {
  const lockedExtension = options.lockExtensions ? item.lockedExtension : "";
  const manualValue = options.manualValues[batchRenameItemKey(item)];
  if (manualValue != null) {
    return { ...item, value: manualValue, lockedExtension };
  }

  let value = options.lockExtensions ? item.value : `${item.value}${item.lockedExtension}`;
  if (options.findText) {
    value = value.split(options.findText).join(options.replaceText);
  }
  value = applyBatchRenameCase(value, options.caseMode);
  value = `${options.prefix}${value}${options.suffix}`;
  if (options.sequenceEnabled) {
    const sequence = String(Math.max(0, options.sequenceStart) + index).padStart(
      Math.max(1, options.sequencePad),
      "0",
    );
    value = `${value}${sequence}`;
  }
  return { ...item, value, lockedExtension };
}

function BatchRenameDialog(props: {
  dialog: NonNullable<ExplorerDialogState> & { kind: "batchRename" };
}) {
  const { dialog } = props;
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [caseMode, setCaseMode] = useState<BatchRenameCaseMode>("none");
  const [lockExtensions, setLockExtensions] = useState(true);
  const [sequenceEnabled, setSequenceEnabled] = useState(false);
  const [sequenceStart, setSequenceStart] = useState(1);
  const [sequencePad, setSequencePad] = useState(2);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const options = useMemo<BatchRenameOptions>(
    () => ({
      findText,
      replaceText,
      prefix,
      suffix,
      caseMode,
      lockExtensions,
      sequenceEnabled,
      sequenceStart,
      sequencePad,
      manualValues,
    }),
    [
      caseMode,
      findText,
      lockExtensions,
      manualValues,
      prefix,
      replaceText,
      sequenceEnabled,
      sequencePad,
      sequenceStart,
      suffix,
    ],
  );
  const previewItems = useMemo(
    () =>
      validateBatchRenameItems(
        dialog.items.map((item, index) => previewBatchRenameItem(item, index, options)),
      ),
    [dialog.items, options],
  );
  const invalidCount = previewItems.filter((item) => item.error).length;
  const firstInvalidIndex = previewItems.findIndex((item) => item.error);
  const readyCount = previewItems.filter(
    (item) => !item.error && `${item.value.trim()}${item.lockedExtension}` !== item.originalName,
  ).length;
  const unchangedCount = previewItems.length - readyCount - invalidCount;
  const updateManualValue = useCallback((item: ExplorerBatchRenameItem, value: string) => {
    setManualValues((current) => ({ ...current, [batchRenameItemKey(item)]: value }));
  }, []);
  const applyPreview = useCallback(() => {
    const store = useExplorerStore.getState();
    store.setBatchRenameItems(dialog.paneId, previewItems);
    void store.confirmDialog();
  }, [dialog.paneId, previewItems]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) useExplorerStore.getState().closeDialog();
      }}
    >
      <DialogContent className={`${dialogChromeClass} ${dialogWideClass}`}>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            applyPreview();
          }}
        >
          <DialogHeader className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-border px-5 py-4 text-left">
            <div>
              <DialogTitle>Batch Rename</DialogTitle>
              <DialogDescription>
                {readyCount} ready, {unchangedCount} unchanged, {invalidCount} need fixes.
              </DialogDescription>
            </div>
            <Badge variant={invalidCount > 0 ? "destructive" : "secondary"}>
              {invalidCount > 0 ? `${invalidCount} need fixes` : `${previewItems.length} selected`}
            </Badge>
          </DialogHeader>
          <div className={controlsClass}>
            <label className={fieldClass}>
              <span>Find</span>
              <Input
                value={findText}
                autoComplete="off"
                onChange={(event) => setFindText(event.target.value)}
              />
            </label>
            <label className={fieldClass}>
              <span>Replace</span>
              <Input
                value={replaceText}
                autoComplete="off"
                onChange={(event) => setReplaceText(event.target.value)}
              />
            </label>
            <label className={fieldClass}>
              <span>Prefix</span>
              <Input
                value={prefix}
                autoComplete="off"
                onChange={(event) => setPrefix(event.target.value)}
              />
            </label>
            <label className={fieldClass}>
              <span>Suffix</span>
              <Input
                value={suffix}
                autoComplete="off"
                onChange={(event) => setSuffix(event.target.value)}
              />
            </label>
            <label className={fieldClass}>
              <span>Case</span>
              <Select
                value={caseMode}
                onValueChange={(value) => setCaseMode(value as BatchRenameCaseMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unchanged</SelectItem>
                  <SelectItem value="lower">lowercase</SelectItem>
                  <SelectItem value="upper">UPPERCASE</SelectItem>
                  <SelectItem value="title">Title Case</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className={fieldClass}>
              <span>Start</span>
              <Input
                type="number"
                min={0}
                value={sequenceStart}
                onChange={(event) => setSequenceStart(Number.parseInt(event.target.value, 10) || 0)}
              />
            </label>
            <label className={fieldClass}>
              <span>Pad</span>
              <Input
                type="number"
                min={1}
                max={8}
                value={sequencePad}
                onChange={(event) =>
                  setSequencePad(
                    Math.min(8, Math.max(1, Number.parseInt(event.target.value, 10) || 1)),
                  )
                }
              />
            </label>
            <label className={toggleClass}>
              <Checkbox
                checked={sequenceEnabled}
                onCheckedChange={(checked) => setSequenceEnabled(Boolean(checked))}
              />
              <span>Number suffix</span>
            </label>
            <label className={toggleClass}>
              <Checkbox
                checked={lockExtensions}
                onCheckedChange={(checked) => {
                  setManualValues({});
                  setLockExtensions(Boolean(checked));
                }}
              />
              <span>Lock extensions</span>
            </label>
          </div>
          <div
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            aria-hidden="true"
          >
            <span>Before</span>
            <span>After</span>
          </div>
          <div className={listClass}>
            {previewItems.map((item, index) => (
              <label
                className={`${rowClass} ${item.error ? rowInvalidClass : ""}`}
                key={batchRenameItemKey(item)}
              >
                <span className="truncate text-muted-foreground" title={item.originalName}>
                  {item.originalName}
                </span>
                <div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <Input
                      value={item.value}
                      autoComplete="off"
                      aria-invalid={Boolean(item.error)}
                      autoFocus={invalidCount > 0 ? index === firstInvalidIndex : false}
                      onChange={(event) => updateManualValue(item, event.target.value)}
                    />
                    {item.lockedExtension ? (
                      <Badge variant="secondary" className="font-mono font-normal">
                        {item.lockedExtension}
                      </Badge>
                    ) : null}
                  </div>
                  {item.error ? (
                    <em className="mt-1 block text-[11px] not-italic text-destructive">
                      {item.error}
                    </em>
                  ) : (
                    <em
                      className={`${`${item.value.trim()}${item.lockedExtension}` === item.originalName ? "text-muted-foreground" : "text-emerald-500"} mt-1 block text-[11px] not-italic`}
                    >
                      {`${item.value.trim()}${item.lockedExtension}` === item.originalName
                        ? "Unchanged"
                        : "Ready"}
                    </em>
                  )}
                </div>
              </label>
            ))}
          </div>
          <DialogFooter className="mt-0 border-t border-border px-5 py-4">
            <Button
              variant="outline"
              type="button"
              onClick={() => useExplorerStore.getState().closeDialog()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={readyCount === 0 || invalidCount > 0}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExplorerDialog() {
  const dialog = useExplorerStore((state) => state.dialog);
  if (!dialog) return null;
  if (dialog.kind === "batchRename") {
    return <BatchRenameDialog dialog={dialog} />;
  }
  const deleteLabel =
    dialog.paths.length === 1
      ? (dialog.paths[0].split("/").filter(Boolean).pop() ?? dialog.paths[0])
      : `${dialog.paths.length} items`;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) useExplorerStore.getState().closeDialog();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Permanently</AlertDialogTitle>
          <AlertDialogDescription>
            Delete <strong className="font-semibold text-foreground">{deleteLabel}</strong>? This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground"
            onClick={() => void useExplorerStore.getState().confirmDialog()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
