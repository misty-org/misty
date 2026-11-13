import { MistyMark, cn } from "@/shared/ui";

export function MistyBrandIcon(props: {
  className?: string;
  size?: number;
  "aria-hidden"?: boolean;
}) {
  const size = props.size ?? 16;

  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center", props.className)}
      aria-hidden={props["aria-hidden"] ?? true}
      data-social-provider-icon="misty"
      style={{ width: size, height: size }}
    >
      <MistyMark size={size} />
    </span>
  );
}
