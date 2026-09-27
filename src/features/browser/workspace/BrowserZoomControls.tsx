import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button, cn, DropdownMenuItem } from "@/shared/ui";

const levels = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

/** Keep the displayed value tied to the page that actually accepted the change. */
export function useBrowserZoom(
  id: string | undefined,
  apply: (factor: number) => Promise<void>,
  report: (error: unknown) => void,
) {
  const [state, setState] = useState({ id, percent: 100, pending: false });
  const currentId = useRef(id);
  currentId.current = id;
  const busy = useRef<string | undefined>(undefined);
  const percent = state.id === id ? state.percent : 100;
  const pending = state.id === id && state.pending;
  const change = async (next: number) => {
    if (!id || busy.current === id || next === percent) return;
    busy.current = id;
    setState({ id, percent, pending: true });
    try {
      await apply(next / 100);
      if (currentId.current === id) setState({ id, percent: next, pending: false });
    } catch (error) {
      if (currentId.current === id) {
        setState({ id, percent, pending: false });
        report(error);
      }
    } finally {
      if (busy.current === id) busy.current = undefined;
    }
  };
  return { percent, disabled: !id || pending, change };
}

export function BrowserZoomControls({
  zoom,
  menu = false,
}: {
  zoom: ReturnType<typeof useBrowserZoom>;
  menu?: boolean;
}) {
  const { percent, disabled, change } = zoom;
  const actions = [
    {
      label: "Zoom out",
      value: [...levels].reverse().find((level) => level < percent),
      content: <Minus size={15} />,
    },
    {
      label: "Reset zoom to 100%",
      value: 100,
      content: <span aria-live="polite">{percent}%</span>,
    },
    {
      label: "Zoom in",
      value: levels.find((level) => level > percent),
      content: <Plus size={15} />,
    },
  ];
  return (
    <div
      className="flex min-h-8 items-center px-2 text-sm"
      role="group"
      aria-label="Page zoom"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="mr-2 flex-1">Zoom</span>
      {actions.map(({ label, value, content }) => {
        const unavailable = disabled || value === undefined;
        const width = label === "Reset zoom to 100%" ? "min-w-12" : "min-w-6";
        return menu ? (
          <DropdownMenuItem
            key={label}
            aria-label={label}
            title={label}
            disabled={unavailable}
            className={cn("min-h-6 w-auto justify-center px-1 py-0 tabular-nums", width)}
            onSelect={(event) => {
              event.preventDefault();
              void change(value!);
            }}
          >
            {content}
          </DropdownMenuItem>
        ) : (
          <Button
            key={label}
            variant="toolbar"
            size="xs"
            className={cn("px-1 tabular-nums", width)}
            aria-label={label}
            title={label}
            disabled={unavailable}
            onClick={() => void change(value!)}
          >
            {content}
          </Button>
        );
      })}
    </div>
  );
}
