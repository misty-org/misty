import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { DropdownMenuItem } from "@/shared/ui";
import "./browserZoom.css";

const levels = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
];

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
      if (currentId.current === id)
        setState({ id, percent: next, pending: false });
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
      className={`browser-zoom-controls${menu ? " browser-zoom-menu-item" : ""}`}
      role="group"
      aria-label="Page zoom"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="browser-zoom-label">Zoom</span>
      {actions.map(({ label, value, content }) => {
        const unavailable = disabled || value === undefined;
        const button = (
          <button
            className="browser-zoom-button"
            type="button"
            aria-label={label}
            title={label}
            disabled={unavailable}
            onClick={menu ? undefined : () => void change(value!)}
          >
            {content}
          </button>
        );
        return menu ? (
          <DropdownMenuItem
            key={label}
            asChild
            disabled={unavailable}
            onSelect={(event) => {
              event.preventDefault();
              void change(value!);
            }}
          >
            {button}
          </DropdownMenuItem>
        ) : (
          <span key={label} className="browser-zoom-action">
            {button}
          </span>
        );
      })}
    </div>
  );
}
