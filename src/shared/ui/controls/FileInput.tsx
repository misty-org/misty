import * as React from "react";

/**
 * A hidden native file picker. Open it from a visible Button via the forwarded ref
 * (`ref.current?.click()`); it has no look of its own.
 */
const FileInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentPropsWithoutRef<"input">, "type" | "hidden" | "className">
>((props, ref) => <input ref={ref} type="file" hidden data-slot="file-input" {...props} />);
FileInput.displayName = "FileInput";

export { FileInput };
