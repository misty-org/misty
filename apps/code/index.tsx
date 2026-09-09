import "@/styles/styles.css";
import { useEffect } from "react";
import { create } from "zustand";
import type { MistyAppCommand, MistyAppSettings, MistySurfaceAdapter } from "@misty/sdk";
import { createSdkCodeComponent } from "@/features/coding-workspace/createSdkCodeComponent";
import { createSdkCodeEditor } from "@/features/coding-workspace/components/createSdkCodeEditor";
import { createCodeLspRegistry } from "@/features/coding-workspace/lsp/registry";
import { createSdkCodeLspTransport } from "@/features/coding-workspace/lsp/sdkTransport";
import { createCodeMirrorLsp } from "@/features/coding-workspace/lsp/createCodeMirrorLsp";
import { createCodeAiAdapter } from "@/features/coding-workspace/ai/createCodeAiAdapter";
import { createInlineRewrite } from "@/features/coding-workspace/ai/createInlineRewrite";
import { useCodeOverlayAppearance } from "@/features/coding-workspace/useCodeOverlayAppearance";

export default createSdkCodeComponent(async ({ misty, runtime, context, signal }) => {
  const events = new EventTarget();
  let closed = false;
  const removers = new Set<() => void>();
  const report = (error: unknown) => { if (!closed) void misty.activity.report(String(error).slice(0, 2000)).catch(() => undefined); };
  const settings = create<{value:MistyAppSettings}>(() => ({value:{}}));
  const retain = (pending: Promise<() => void>) => {
    let removed = false, cleanup: (() => void) | undefined;
    const remove = () => { removed = true; cleanup?.(); removers.delete(remove); };
    removers.add(remove);
    void pending.then(next => { if (removed || closed) next(); else cleanup = next; }).catch(report);
    return remove;
  };
  const close = () => { if (closed) return; closed = true; removers.forEach(remove => remove()); registry.close(); editor?.close(); };
  const registry = createCodeLspRegistry(createSdkCodeLspTransport(misty), signal);
  let editor: ReturnType<typeof createSdkCodeEditor> | undefined;
  try {
    const removeSettings = await misty.settings.subscribe(value => settings.setState({value}));
    removers.add(removeSettings);
    settings.setState({value: await misty.settings.snapshot()});
    if (signal?.aborted) throw new Error("Code closed while opening.");
    if (!settings.getState().value.code) throw new Error("Update Misty to use this version of Code.");
    const usePreferences = () => settings(s => s.value.code!);
    const registerShortcutHandler = (id: string, run:()=>boolean|void, active:()=>boolean = () => true) =>
      retain(misty.shortcuts.register(id as MistyAppCommand, () => { if (!closed && active()) run(); }));
    const useShortcutHandler = (id: string, run:()=>void, active:()=>boolean) =>
      useEffect(() => registerShortcutHandler(id, run, active), [id, run, active]);
    function ShortcutHint({commandId}:{commandId:string}) {
      const label = settings(s => s.value.shortcutLabels?.[commandId]);
      return label ? <kbd>{label}</kbd> : null;
    }
    function ErrorActivity({error, title}:{error:string;title:string}) {
      return <div role="alert" className="p-3 text-sm text-cream-muted"><strong>{title}</strong><p>{error}</p></div>;
    }
    const lsp = createCodeMirrorLsp({getLspClient:registry.get, editorStore:runtime.editor, events});
    editor = createSdkCodeEditor(runtime, {lsp, events, usePreferences, useShortcutHandler, ErrorActivity});
    const useCodeAiAdapter = createCodeAiAdapter(runtime.store, (adapter: MistySurfaceAdapter) => {
      useEffect(() => retain(misty.surfaces.register(adapter)), [adapter]);
    });
    const InlineRewrite = createInlineRewrite({
      useSettings: () => ({providerId:"host", model:"Configured model"}),
      useShortcutHandler, ShortcutHint, SystemErrorActivity:ErrorActivity,
      async rewrite({signal: requestSignal, onDelta, ...input}) {
        const requestId = crypto.randomUUID();
        const cancel = () => { void misty.code.cancelRewrite(requestId).catch(report); };
        requestSignal.addEventListener("abort", cancel, {once:true});
        try {
          if (requestSignal.aborted) return;
          const result = await misty.code.rewrite({...input, requestId});
          if (!requestSignal.aborted && !closed) onDelta(result);
        } finally { requestSignal.removeEventListener("abort", cancel); }
      },
    });
    let dirty: boolean | undefined;
    const publishDirty = () => {
      const next = Object.values(runtime.store.getState().projectBuffers).some(buffers => Object.values(buffers).some(b => b.contents !== b.savedContents));
      if (next !== dirty) { dirty = next; void misty.workspace.setUnsavedChanges(next).catch(report); }
    };
    removers.add(runtime.store.subscribe(publishDirty));
    publishDirty();
    return {
      services: {
        ...editor, usePreferences, events, ErrorActivity, ShortcutHint, InlineRewrite,
        useCodeAiAdapter, useOverlayAppearance: useCodeOverlayAppearance,
        retainLspRoot: registry.retainRoot, findReferencesAt:lsp.findReferencesAt,
        documentVersion:lsp.documentVersion, registerShortcutHandler, report,
        useShortcutTitle: (title, command) => {
          const label = settings(s => s.value.shortcutLabels?.[command]);
          return label ? `${title} (${label})` : title;
        },
        updatePreference: (key, value) => { void misty.code.updatePreference({key, value}).catch(report); },
        openModelsSettings: () => { void misty.code.openModels().catch(report); },
        toggleTerminal: (placement) => misty.code.toggleTerminal(placement),
      },
      spaceId: (await misty.context.get()).space?.id,
      close,
    };
  } catch (error) { close(); throw error; }
});
