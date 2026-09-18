import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { setWindowColor } from "@/features/workspace/windows";
import {
  isWindowColor,
  windowColorHex,
  windowColorNames,
  windowColors,
  type WindowColor,
} from "@/features/workspace/windowColors";
import {
  setNavigationName,
  useNavigationNames,
  validateNavigationName,
  windowNameKey,
} from "@/features/navigation-names/store";
import { Button, Input, Popover, PopoverAnchor, PopoverContent, Pressable } from "@/shared/ui";
import { useWindowColorRequest, visibleWindowColorAnchor } from "./windowColorRequest";
import "./tabGroups.css";

/**
 * The window color picker. It opens beside the virtual window menu's trigger, and every
 * color tried tints the window live; the choice is kept only on Save (or Create window for
 * a new window). Closing it any other way puts the window back as it was. A new window
 * must be given a color, so nothing is preselected for it.
 */
export function WindowColorPopover(props: { onCreated(): void }) {
  const request = useWindowColorRequest((state) => state.request);
  const preview = useWindowColorRequest((state) => state.preview);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // The system color panel takes focus from the page while a custom color is picked.
  const picking = useRef(false);
  const open = request !== null && anchor !== null;
  const editing = request?.kind === "edit";

  const current = useWorkspaceStore((state) =>
    request?.kind === "edit"
      ? (state.windowsByScope[state.activeScopeKey] ?? []).find(
          (item) => item.id === request.windowId,
        )?.color
      : undefined,
  );
  const chosen = preview ?? current ?? null;
  // The name shown for the window now: a name the person set, else its automatic one.
  const shownName = useNavigationNames((state) => {
    if (request?.kind !== "edit") return "";
    const windows = useWorkspaceStore.getState().windowsByScope;
    const automatic =
      (windows[useWorkspaceStore.getState().activeScopeKey] ?? []).find(
        (item) => item.id === request.windowId,
      )?.title ?? "";
    return state.names[windowNameKey(request.windowId)] ?? automatic;
  });
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const colorChanged = preview !== null && preview !== current;
  const nameChanged = editing && name.trim() !== shownName;
  const changed = editing ? colorChanged || nameChanged : colorChanged;

  useEffect(() => {
    picking.current = false;
    setError("");
    setName(shownName);
    setAnchor(request ? visibleWindowColorAnchor() : null);
    // Only when a request opens: later name changes must not overwrite typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // The page is a native view above the app's own UI; it steps aside while this is open.
  useEffect(() => {
    setBrowserWebviewsSuspended(open, "window-color");
    return () => setBrowserWebviewsSuspended(false, "window-color");
  }, [open]);

  const select = (color: WindowColor) => {
    useWindowColorRequest.getState().setPreview(color);
  };
  const close = () => useWindowColorRequest.getState().close();
  const confirm = async () => {
    if (!request) return;
    const store = useWorkspaceStore.getState();
    if (request.kind === "edit") {
      try {
        if (nameChanged)
          await setNavigationName(windowNameKey(request.windowId), validateNavigationName(name));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      if (preview) useWorkspaceStore.setState(setWindowColor(store, request.windowId, preview));
    } else if (preview) {
      store.createWindow(undefined, preview);
      props.onCreated();
    }
    close();
  };

  const customSelected = chosen !== null && chosen.startsWith("#");
  return (
    <Popover open={open} onOpenChange={(next) => !next && close()}>
      {anchor ? <PopoverAnchor virtualRef={{ current: anchor }} /> : null}
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-64 max-w-[calc(100vw-24px)] p-3"
        onInteractOutside={(event) => {
          // Only a press outside leaves the picker. Focus moves on their own (the menu
          // handing focus back, the page stepping aside, the system color panel opening)
          // as colors are tried, and must never close it.
          if (picking.current || event.type === "focusin") event.preventDefault();
        }}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <p className="text-sm font-medium text-cream">
          {editing ? "Edit window" : "Choose a window color"}
        </p>
        {editing ? (
          <Input
            aria-label="Window name"
            value={name}
            className="mt-2"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && changed) void confirm();
            }}
          />
        ) : null}
        <p className="mt-2 text-xs text-cream-muted">
          The color tints this window's frame, navigator and tabs. Page content stays as it is.
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-cream">
            {error}
          </p>
        ) : null}
        <div role="radiogroup" aria-label="Window color" className="flex justify-between py-3">
          {windowColorNames.map((name) => (
            <Pressable
              key={name}
              type="button"
              role="radio"
              aria-label={name}
              aria-checked={chosen === name}
              className="misty-tab-group-swatch"
              style={{ backgroundColor: windowColors[name] }}
              onClick={() => {
                picking.current = false;
                select(name);
              }}
            >
              {chosen === name ? <Check aria-hidden="true" /> : null}
            </Pressable>
          ))}
          <label
            className="misty-tab-group-swatch relative cursor-pointer"
            aria-label="Custom color"
            style={
              customSelected && chosen
                ? { backgroundColor: windowColorHex(chosen) }
                : {
                    background:
                      "conic-gradient(#f28b82, #fdd663, #81c995, #78d9ec, #8ab4f8, #c58af9, #ff8bcb, #f28b82)",
                  }
            }
          >
            {customSelected ? <Check aria-hidden="true" /> : null}
            <Input
              type="color"
              variant="bare"
              aria-label="Custom color"
              value={customSelected && chosen ? windowColorHex(chosen) : "#8ab4f8"}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              onPointerDown={() => {
                picking.current = true;
              }}
              onChange={(event) => {
                const value = event.target.value.toLowerCase();
                if (isWindowColor(value)) select(value);
              }}
            />
          </label>
        </div>
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!changed} onClick={() => void confirm()}>
            {editing ? "Save" : "Create window"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
