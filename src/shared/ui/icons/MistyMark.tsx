import type { SVGProps } from "react";

type MistyMarkProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  /** Width and height; leave it out to size the mark with `className` instead. */
  size?: number | string;
};

/**
 * Misty's mark, drawn in the current text color: an M whose left stroke curls into a drop. It is
 * two strokes with round ends, the same shape the menu bar icon draws natively
 * (`src-tauri/features/app/tray_mark.rs`). It stands bare, never on a tile.
 *
 * `<MistyMark size={16} />` or `<MistyMark className="size-5" />`
 */
export function MistyMark({ size, className, ...props }: MistyMarkProps) {
  return (
    <svg
      viewBox="36 36 440 440"
      fill="none"
      stroke="currentColor"
      strokeWidth={30}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0 }}
      {...props}
    >
      <path d="M183.7 400.5A60 60 0 0 1 65.5 386V126A60 60 0 0 1 171.6 87.6L317.1 262.3A73 73 0 1 1 204.9 262.3L227.9 234.6" />
      <path d="M328.3 400.5A60 60 0 0 0 446.5 386V126A60 60 0 0 0 340.4 87.6L289.2 149.1" />
    </svg>
  );
}
