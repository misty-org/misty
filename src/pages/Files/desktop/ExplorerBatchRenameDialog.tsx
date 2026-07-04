import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { validateBatchRenameItems, useExplorerStore } from "../../../stores/useExplorerStore";
import type { ExplorerBatchRenameItem, ExplorerDialogState } from "../../../stores/useExplorerStore";
import { cx } from "./ExplorerDesktopShared";
import { dialogStyles } from "./ExplorerDesktopDialogStyles";

type BatchRenameCaseMode = "none" | "lower" | "upper" | "title";
interface BatchRenameOptions {
  findText: string;
  replaceText: string;
  prefix: string;
  suffix: string;
  caseMode: BatchRenameCaseMode;
  lockExtensions: boolean;
  sequenceEnabled: boolean;
  sequenceStart: number;
  sequencePad: number;
  manualValues: Record<string, string>;
}

function batchRenameItemKey(item: ExplorerBatchRenameItem): string {
  return `${item.paneId}:${item.entryId}`;
}

function applyBatchRenameCase(value: string, mode: BatchRenameCaseMode): string {
  if (mode === "lower") return value.toLocaleLowerCase();
  if (mode === "upper") return value.toLocaleUpperCase();
  if (mode === "title") {
    return value
      .toLocaleLowerCase()
      .replace(/(^|[\s._-])([a-z])/g, (_match, boundary: string, character: string) => `${boundary}${character.toLocaleUpperCase()}`);
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
    const sequence = String(Math.max(0, options.sequenceStart) + index).padStart(Math.max(1, options.sequencePad), "0");
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
  const options = useMemo<BatchRenameOptions>(() => ({
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
  }), [caseMode, findText, lockExtensions, manualValues, prefix, replaceText, sequenceEnabled, sequencePad, sequenceStart, suffix]);
  const previewItems = useMemo(
    () => validateBatchRenameItems(dialog.items.map((item, index) => previewBatchRenameItem(item, index, options))),
    [dialog.items, options],
  );
  const invalidCount = previewItems.filter((item) => item.error).length;
  const firstInvalidIndex = previewItems.findIndex((item) => item.error);
  const readyCount = previewItems.filter((item) => !item.error && `${item.value.trim()}${item.lockedExtension}` !== item.originalName).length;
  const unchangedCount = previewItems.length - readyCount - invalidCount;
  const updateManualValue = useCallback((item: ExplorerBatchRenameItem, value: string) => {
    setManualValues((current) => ({ ...current, [batchRenameItemKey(item)]: value }));
  }, []);
  const applyPreview = useCallback(() => {
    const store = useExplorerStore.getState();
    store.setBatchRenameItems(dialog.paneId, previewItems);
    void store.confirmDialog();
  }, [dialog.paneId, previewItems]);

  return createPortal(
    <div className={dialogStyles.backdrop} role="presentation">
      <form
        className={cx(dialogStyles.dialog, dialogStyles.wide)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          applyPreview();
        }}
      >
        <header className={dialogStyles.batchHeader}>
          <div>
            <h2 className={dialogStyles.title} id="explorer-dialog-title">Batch Rename</h2>
            <p className={dialogStyles.text}>{readyCount} ready, {unchangedCount} unchanged, {invalidCount} need fixes.</p>
          </div>
          <span className={dialogStyles.batchBadge}>{invalidCount > 0 ? `${invalidCount} need fixes` : `${previewItems.length} selected`}</span>
        </header>
        <div className={dialogStyles.batchControls}>
          <label className={dialogStyles.batchField}>
            <span>Find</span>
            <input className={dialogStyles.input} value={findText} autoComplete="off" onChange={(event) => setFindText(event.target.value)} />
          </label>
          <label className={dialogStyles.batchField}>
            <span>Replace</span>
            <input className={dialogStyles.input} value={replaceText} autoComplete="off" onChange={(event) => setReplaceText(event.target.value)} />
          </label>
          <label className={dialogStyles.batchField}>
            <span>Prefix</span>
            <input className={dialogStyles.input} value={prefix} autoComplete="off" onChange={(event) => setPrefix(event.target.value)} />
          </label>
          <label className={dialogStyles.batchField}>
            <span>Suffix</span>
            <input className={dialogStyles.input} value={suffix} autoComplete="off" onChange={(event) => setSuffix(event.target.value)} />
          </label>
          <label className={dialogStyles.batchField}>
            <span>Case</span>
            <select className={dialogStyles.batchSelect} value={caseMode} onChange={(event) => setCaseMode(event.target.value as BatchRenameCaseMode)}>
              <option value="none">Unchanged</option>
              <option value="lower">lowercase</option>
              <option value="upper">UPPERCASE</option>
              <option value="title">Title Case</option>
            </select>
          </label>
          <label className={dialogStyles.batchField}>
            <span>Start</span>
            <input
              className={dialogStyles.input}
              type="number"
              min={0}
              value={sequenceStart}
              onChange={(event) => setSequenceStart(Number.parseInt(event.target.value, 10) || 0)}
            />
          </label>
          <label className={dialogStyles.batchField}>
            <span>Pad</span>
            <input
              className={dialogStyles.input}
              type="number"
              min={1}
              max={8}
              value={sequencePad}
              onChange={(event) => setSequencePad(Math.min(8, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))}
            />
          </label>
          <label className={dialogStyles.batchToggle}>
            <input className={dialogStyles.batchCheckbox} type="checkbox" checked={sequenceEnabled} onChange={(event) => setSequenceEnabled(event.target.checked)} />
            <span>Number suffix</span>
          </label>
          <label className={dialogStyles.batchToggle}>
            <input
              className={dialogStyles.batchCheckbox}
              type="checkbox"
              checked={lockExtensions}
              onChange={(event) => {
                setManualValues({});
                setLockExtensions(event.target.checked);
              }}
            />
            <span>Lock extensions</span>
          </label>
        </div>
        <div className={dialogStyles.batchHead} aria-hidden="true">
          <span>Before</span>
          <span>After</span>
        </div>
        <div className={dialogStyles.batchList}>
          {previewItems.map((item, index) => (
            <label className={cx(dialogStyles.batchRow, item.error && dialogStyles.batchRowInvalid)} key={batchRenameItemKey(item)}>
              <span className={dialogStyles.batchBefore} title={item.originalName}>{item.originalName}</span>
              <div>
                <div className={dialogStyles.batchInputWrap}>
                  <input
                    className={cx(dialogStyles.input, dialogStyles.batchInput)}
                    value={item.value}
                    autoComplete="off"
                    aria-invalid={Boolean(item.error)}
                    autoFocus={invalidCount > 0 ? index === firstInvalidIndex : false}
                    onChange={(event) => updateManualValue(item, event.target.value)}
                  />
                  {item.lockedExtension ? <small className={dialogStyles.batchExtension}>{item.lockedExtension}</small> : null}
                </div>
                {item.error ? <em className={dialogStyles.batchError}>{item.error}</em> : (
                  <em className={cx(
                    dialogStyles.batchError,
                    `${item.value.trim()}${item.lockedExtension}` === item.originalName ? dialogStyles.batchMuted : dialogStyles.batchReady,
                  )}>
                    {`${item.value.trim()}${item.lockedExtension}` === item.originalName ? "Unchanged" : "Ready"}
                  </em>
                )}
              </div>
            </label>
          ))}
        </div>
        <div className={dialogStyles.actions}>
          <button className={dialogStyles.actionButton} type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
          <button className={dialogStyles.actionButton} type="submit" disabled={readyCount === 0 || invalidCount > 0}>Apply</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function ExplorerDialog() {
  const dialog = useExplorerStore((state) => state.dialog);
  if (!dialog) return null;
  if (dialog.kind === "batchRename") {
    return <BatchRenameDialog dialog={dialog} />;
  }
  const deleteLabel = dialog.paths.length === 1
    ? dialog.paths[0].split("/").filter(Boolean).pop() ?? dialog.paths[0]
    : `${dialog.paths.length} items`;

  return createPortal(
    <div className={dialogStyles.backdrop} role="presentation">
      <form
        className={dialogStyles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void useExplorerStore.getState().confirmDialog();
        }}
      >
        <h2 className={dialogStyles.title} id="explorer-dialog-title">Delete Permanently</h2>
        <p className={dialogStyles.text}>Delete <strong>{deleteLabel}</strong>? This cannot be undone.</p>
        <div className={dialogStyles.actions}>
          <button className={dialogStyles.actionButton} type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
          <button type="submit" className={cx(dialogStyles.actionButton, dialogStyles.danger)}>Delete</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
