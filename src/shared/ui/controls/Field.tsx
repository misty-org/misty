import * as React from "react";
import { cn } from "../utils";
import { Label } from "./Label";

type FieldProps = {
  label: React.ReactNode;
  /** Muted help text under the control; replaced by `error` when present. */
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** "stacked" puts the control under the label; "inline" puts it on the right (switches, selects). */
  layout?: "stacked" | "inline";
  className?: string;
  /** A single control; it receives the generated id and describedby wiring. */
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
};

/** Label + control + hint/error, wired for accessibility. Forms and settings rows use this. */
function Field({ label, hint, error, layout = "stacked", className, children }: FieldProps) {
  const generatedId = React.useId();
  const id = children.props.id ?? generatedId;
  const noteId = `${id}-note`;
  const note = error ?? hint;
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
        {layout === "inline" && note ? <FieldNote id={noteId} error={Boolean(error)} note={note} /> : null}
      </div>
      {control}
      {layout === "stacked" && note ? <FieldNote id={noteId} error={Boolean(error)} note={note} /> : null}
    </div>
  );
}

function FieldNote(props: { id: string; error: boolean; note: React.ReactNode }) {
  return (
    <p
      id={props.id}
      role={props.error ? "alert" : undefined}
      className={cn("m-0 text-xs leading-4", props.error ? "text-cream-bright" : "text-cream-muted")}
    >
      {props.note}
    </p>
  );
}

export { Field };
export type { FieldProps };
