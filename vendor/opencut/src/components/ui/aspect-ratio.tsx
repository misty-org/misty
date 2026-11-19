// Misty: a box that keeps a width-to-height ratio.
import type { HTMLAttributes } from "react";
export function AspectRatio({
	ratio = 1,
	style,
	...props
}: HTMLAttributes<HTMLDivElement> & { ratio?: number }) {
	return <div style={{ ...style, aspectRatio: String(ratio) }} {...props} />;
}
