import { Pin } from "lucide-react";
import "./websiteChrome.css";

export function PagePinButton(props: {
  pinned: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  const label = props.pinned ? "Unpin" : "Pin";
  return (
    <button
      type="button"
      className="website-icon-button website-pin-button"
      aria-label={label}
      title={label}
      aria-pressed={props.pinned}
      aria-busy={props.busy || undefined}
      disabled={props.disabled || props.busy}
      onClick={props.onClick}
    >
      <Pin size={16} fill={props.pinned ? "currentColor" : "none"} />
    </button>
  );
}
