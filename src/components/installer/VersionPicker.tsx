import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSetupStore } from "../../stores/useSetupStore";

export function VersionPicker() {
  const { busy, releases, releasesLoading, selectedVersion, setSelectedVersion } = useSetupStore(
    useShallow((state) => ({
      busy: state.busy,
      releases: state.releases,
      releasesLoading: state.releasesLoading,
      selectedVersion: state.selectedVersion,
      setSelectedVersion: state.setSelectedVersion,
    })),
  );
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState({ left: 0, top: 0, width: 0, maxHeight: 208 });
  const latestVersion = releases[0]?.version ?? selectedVersion;
  const release = releases.find((entry) => entry.version === selectedVersion) ?? releases[0];
  const menuViewportMargin = 14;
  const menuChromeHeight = 12;
  const menuMaxHeight = 180;
  const menuMinHeight = 96;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updateMenuRect() {
      const trigger = triggerRef.current;

      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - menuViewportMargin;
      const spaceAbove = rect.top - menuViewportMargin;
      const shouldOpenAbove = spaceBelow < menuMinHeight + menuChromeHeight && spaceAbove > spaceBelow;
      const availableSpace = shouldOpenAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(
        menuMinHeight,
        Math.min(menuMaxHeight, availableSpace - menuChromeHeight),
      );

      const menuWidth = Math.min(
        Math.max(rect.width, 352),
        window.innerWidth - menuViewportMargin * 2,
      );
      const menuLeft = Math.min(
        Math.max(rect.left, menuViewportMargin),
        window.innerWidth - menuWidth - menuViewportMargin,
      );

      setMenuRect({
        left: menuLeft,
        top: shouldOpenAbove ? rect.top - maxHeight - menuChromeHeight : rect.bottom + 8,
        width: menuWidth,
        maxHeight,
      });
    }

    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);

    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative w-full min-w-0">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-white/10 bg-[#080b0e] px-3.5 text-left text-sm font-semibold text-white outline-none transition hover:border-white/20 hover:bg-[#0b1014] focus:border-[#7dd3fc] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy || releasesLoading}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 whitespace-nowrap tabular-nums">{release?.version ?? "Loading"}</span>
          <span className="min-w-0 truncate text-[11px] font-medium text-[#8f99a6]">
            {releasesLoading ? "Fetching releases" : release?.version === latestVersion ? "Latest release" : release?.date}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-[#a1a1aa] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        createPortal(
        <div
          className="fixed z-50 overflow-hidden rounded-lg border border-white/10 bg-[#050607] p-1 shadow-2xl shadow-black/50"
          ref={menuRef}
          style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
        >
          <div
            className="grid gap-1 overflow-y-auto overscroll-contain"
            role="listbox"
            aria-label="Version"
            style={{ maxHeight: menuRect.maxHeight }}
          >
            {releases.map((release) => {
              const selected = release.version === selectedVersion;

              return (
                <button
                  aria-selected={selected}
                  className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition ${
                    selected
                      ? "bg-[#f4f4f5] text-[#07090b]"
                      : "text-[#d4d4d8] hover:bg-[#18181b] hover:text-white"
                  }`}
                  key={release.version}
                  onClick={() => {
                    setSelectedVersion(release.version);
                    setOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{release.version}</span>
                    <span className={selected ? "block truncate text-xs text-[#3f3f46]" : "block truncate text-xs text-[#949ba4]"}>
                      {release.date}
                    </span>
                  </span>
                  <span className={selected ? "shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-bold text-[#27272a]" : "shrink-0 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-[#71717a]"}>
                    {release.version === latestVersion ? "Latest" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
