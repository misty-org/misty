import * as React from "react";
import { cn } from "../classNames";
import { ErrorNotification } from "../feedback/Notification";
import { Label } from "./Label";

type FieldProps = {
  label: React.ReactNode;
  /** Muted help text under the control. */
  hint?: React.ReactNode;
  /** Shown as a corner notification, never inline. */
  error?: React.ReactNode;
  /** "stacked" puts the control under the label; "inline" puts it on the right (switches, selects). */
  layout?: "stacked" | "inline";
  className?: string;
  /** A single control; it receives the generated id and describedby wiring. */
  children: React.ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>;
};

/** Label + control + hint/error, wired for accessibility. Forms and settings rows use this. */
function Field({ label, hint, error, layout = "stacked", className, children }: FieldProps) {
  const generatedId = React.useId();
  const id = children.props.id ?? generatedId;
  const noteId = `${id}-note`;
  const note = hint;
  const control = React.cloneElement(children, {
    id,
    "aria-describedby": note ? noteId : undefined,
    "aria-invalid": error ? true : undefined,
  });
  return (
    <div
      data-slot="field"
      className={cn(
        layout === "stacked" ? "grid gap-1.5" : "flex items-center justify-between gap-4",
        className,
      )}
    >
      <div className="grid min-w-0 gap-1">
        <Label htmlFor={id} className="text-cream">
          {label}
        </Label>
        {layout === "inline" && note ? <FieldNote id={noteId} note={note} /> : null}
      </div>
      {control}
      {layout === "stacked" && note ? <FieldNote id={noteId} note={note} /> : null}
      <ErrorNotification message={error} />
    </div>
  );
}

function FieldNote(props: { id: string; note: React.ReactNode }) {
  return (
    <p id={props.id} className="m-0 text-xs leading-4 text-cream-muted">
      {props.note}
    </p>
  );
}

export { Field };
