import { Expand } from "lucide-react";
import { useMemo, useState } from "react";
import { eventIcon } from "./icons";
import { PanelModal } from "./PanelModal";
import { useSetupStore } from "../store/useSetupStore";

const defaultLogHeight = 260;

export function LoggerPanel({
  source,
  emptyLabel = "quiet for now",
  className = "",
  fill = false,
}: {
  source: "installer" | "launcher" | "all";
  emptyLabel?: string;
  className?: string;
  fill?: boolean;
}) {
  const events = useSetupStore((state) => state.events);
  const [showModal, setShowModal] = useState(false);
  const filteredEvents = useMemo(
    () => source === "all" ? events : events.filter((event) => event.source === source),
    [events, source],
  );

  return (
    <>
      <footer
        className={`flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-[#1e1e21] bg-[#050607] text-xs text-[#949ba4] shadow-2xl shadow-black/40 ${className}`}
        style={fill ? undefined : { height: defaultLogHeight }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#8f8f8f] uppercase">
            Activity Log
          </p>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-[#d4d4d8] uppercase transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            onClick={() => setShowModal(true)}
            type="button"
          >
            <Expand className="h-3.5 w-3.5" />
            Pop out
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
            {filteredEvents.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-[#71717a]">
                {emptyLabel}
              </div>
            ) : (
              <ul className="grid gap-2">
                {filteredEvents.map((event, index) => (
                  <li
                    className={
                      event.level === "error"
                        ? "flex gap-2 text-red-300"
                        : event.level === "warn"
                          ? "flex gap-2 text-amber-300"
                          : "flex gap-2 text-[#dbdee1]"
                    }
                    key={`${event.level}-${index}`}
                  >
                    {eventIcon(event.level)}
                    <span className="min-w-0 break-words">[{event.level}] {event.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </footer>

      {showModal ? (
        <PanelModal
          onClose={() => setShowModal(false)}
          subtitle={`${filteredEvents.length} event${filteredEvents.length === 1 ? "" : "s"}`}
          title="Activity log"
        >
          <div className="px-5 py-4">
            {filteredEvents.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#71717a]">{emptyLabel}</div>
            ) : (
              <ul className="grid gap-3 text-sm">
                {filteredEvents.map((event, index) => (
                  <li
                    className={
                      event.level === "error"
                        ? "flex gap-3 text-red-300"
                        : event.level === "warn"
                          ? "flex gap-3 text-amber-300"
                          : "flex gap-3 text-[#dbdee1]"
                    }
                    key={`${event.level}-modal-${index}`}
                  >
                    {eventIcon(event.level)}
                    <span className="min-w-0 break-words">[{event.level}] {event.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PanelModal>
      ) : null}
    </>
  );
}
