import * as React from "react";
import { cn } from "../classNames";
import { Label } from "./Label";

type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

type FieldProps = {
  label: React.ReactNode;
  /**
   * What went wrong with this field, shown right under the control in the danger color and
   * read out with it. Clear it once the value changes.
   */
  error?: React.ReactNode;
  /** "stacked" puts the control under the label; "inline" puts it on the right (switches, selects). */
  layout?: "stacked" | "inline";
  className?: string;
  /** A single control; it receives the generated id and the describedby and invalid wiring. */
  children: React.ReactElement<FieldControlProps>;
};

/**
 * A field's error, under its control. Field draws this itself; use it directly beside a custom
 * control, giving the control `aria-describedby={id}` and `aria-invalid`.
 */
function FieldError({
  id,
  message,
  className,
}: {
  id?: string;
  message?: React.ReactNode;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} data-slot="field-error" className={cn("m-0 text-meta text-danger", className)}>
      {message}
    </p>
  );
}

/** Label, control and its error, wired for assistive technology. Forms use this. */
function Field({ label, error, layout = "stacked", className, children }: FieldProps) {
  const generatedId = React.useId();
  const id = children.props.id ?? generatedId;
  const errorId = `${id}-error`;
  const describedBy =
    [children.props["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") ||
    undefined;
  const control = React.cloneElement(children, {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });
  return (
    <div data-slot="field" className={cn("grid gap-1.5", className)}>
      {layout === "stacked" ? (
        <>
          <Label htmlFor={id} className="text-cream">
            {label}
          </Label>
          {control}
        </>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={id} className="min-w-0 text-cream">
            {label}
          </Label>
          {control}
        </div>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export { Field, FieldError };
