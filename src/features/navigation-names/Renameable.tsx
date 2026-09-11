import { Pencil, RotateCcw } from "lucide-react";
import { cloneElement, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { setBrowserWebviewsSuspended } from "@/features/browser/browserRuntime";
import {
  setNavigationName,
  useNavigationName,
  useNavigationNames,
  validateNavigationName,
} from "./store";

/** A local label editor. Never invokes a file, document, or provider rename. */
export function Renameable({
  nameKey,
  automatic,
  children,
  customName,
  onRename,
  resetLabel = "Reset",
}: {
  customName?: string;
  onRename?: (name: string | null) => void;
  resetLabel?: string;
  nameKey: string;
  automatic: string;
  children: ReactElement;
}) {
  const storedName = useNavigationName(nameKey, automatic);
  const storedCustom = useNavigationNames((s) => s.names[nameKey] !== undefined);
  const name = onRename ? customName || automatic : storedName;
  const custom = onRename ? Boolean(customName) : storedCustom;
  const [editing, setEditing] = useState(false),
    [menu, setMenu] = useState(false),
    [error, setError] = useState("");
  const anchor = useRef<HTMLElement | null>(null),
    input = useRef<HTMLInputElement>(null),
    done = useRef(false),
    pendingRename = useRef(false);
  const reason = `rename:${nameKey}`;
  useEffect(() => {
    setBrowserWebviewsSuspended(menu || editing, reason);
    return () => setBrowserWebviewsSuspended(false, reason);
  }, [menu, editing, reason]);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const close = () => {
    setEditing(false);
    const element = anchor.current;
    (element?.querySelector<HTMLElement>("button, a, [role=tab], [tabindex]") ?? element)?.focus();
  };
  const commit = async () => {
    if (done.current) return;
    let value: string;
    try {
      value = validateNavigationName(input.current?.value ?? "");
    } catch (e) {
      setError(String(e));
      input.current?.focus();
      return;
    }
    done.current = true;
    try {
      if (onRename) onRename(value);
      else await setNavigationName(nameKey, value);
      close();
    } catch (e) {
      done.current = false;
      setError(String(e));
      input.current?.focus();
    }
  };
  const rect = anchor.current?.getBoundingClientRect();
  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          setMenu(open);
          if (open) setBrowserWebviewsSuspended(true, reason);
        }}
      >
        <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>
          {cloneElement(children, {
            ref: (element: HTMLElement | null) => {
              anchor.current = element;
            },
          } as object)}
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            if (pendingRename.current) {
              event.preventDefault();
              pendingRename.current = false;
              setEditing(true);
            } else if (editing) event.preventDefault();
          }}
        >
          <ContextMenuItem
            onSelect={() => {
              done.current = false;
              setError("");
              pendingRename.current = true;
            }}
          >
            <Pencil aria-hidden="true" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!custom}
            onSelect={() => {
              if (onRename) onRename(null);
              else void setNavigationName(nameKey, null).catch((e) => setError(String(e)));
            }}
          >
            <RotateCcw aria-hidden="true" />
            {resetLabel}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {editing &&
        rect &&
        createPortal(
          <div
            data-misty-window-drag-block="true"
            data-navigation-name-editor="true"
            className="fixed z-[2147483401]"
            style={{
              left: Math.max(4, rect.left),
              top: rect.top,
              width: Math.min(Math.max(rect.width, 150), window.innerWidth - rect.left - 8),
            }}
          >
            <input
              ref={input}
              aria-label={`Rename ${name}`}
              defaultValue={name}
              className="h-8 w-full rounded border border-cream-muted bg-charcoal-card px-2 text-sm text-cream outline-none"
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  done.current = true;
                  close();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  void commit();
                }
              }}
            />
            {error && (
              <div role="alert" className="rounded bg-charcoal-card p-2 text-xs text-cream">
                {error}
              </div>
            )}
          </div>,
          document.body,
        )}
      {!editing && error && (
        <span role="alert" className="text-xs text-cream">
          {error}
        </span>
      )}
    </>
  );
}
