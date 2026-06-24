import { Compass } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNewTabOptions, type NewTabOption } from "./WorkspaceNewTabMenu";

export function WorkspaceAppGallery(props: {
  paneId: string;
  onOpenNewTab: (option: NewTabOption, paneId: string) => void;
}) {
  const options = useNewTabOptions();
  const gallery = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focus = (event: Event) => {
      if ((event as CustomEvent<{ paneId?: string }>).detail?.paneId === props.paneId)
        gallery.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    window.addEventListener("misty:open-new-tab-picker", focus);
    return () => window.removeEventListener("misty:open-new-tab-picker", focus);
  }, [props.paneId]);
  return (
    <div ref={gallery} className="flex h-full min-h-0 overflow-y-auto px-6 py-10">
      <section className="m-auto w-full max-w-[440px]" aria-label="Apps">
        <h2 className="mb-6 text-center text-lg font-medium tracking-tight text-cream-bright">
          Apps
        </h2>
        {options.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3">
            {options.map((option) => (
              <button
                key={option.appId}
                type="button"
                onClick={() => props.onOpenNewTab(option, props.paneId)}
                className="group flex aspect-square min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-charcoal-border bg-charcoal-card px-2 text-cream-muted transition-colors hover:border-cream-muted/40 hover:bg-charcoal-hover hover:text-cream-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-workspace"
              >
                <option.icon
                  size={28}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="shrink-0 text-cream-bright"
                />
                <span className="max-w-full truncate text-[13px] font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-cream-muted">
            Add apps to this Space to get started.
          </p>
        )}
        <div className="mt-7 flex justify-center">
          <button
            type="button"
            className="flex min-h-9 items-center gap-2 rounded px-2 text-xs text-cream-muted transition-colors hover:text-cream-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted"
            onClick={() =>
              props.onOpenNewTab(
                { surfaceId: "marketplace", label: "Discover", route: "/discover", icon: Compass },
                props.paneId,
              )
            }
          >
            <Compass size={14} aria-hidden="true" />
            <span>Browse more apps</span>
          </button>
        </div>
      </section>
    </div>
  );
}
