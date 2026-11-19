// Misty: Next.js's Image is a plain image here; the app has no image optimizer.
import type { ImgHTMLAttributes } from "react";

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
	src: string;
	unoptimized?: boolean;
	priority?: boolean;
	fill?: boolean;
};

export default function Image({ unoptimized: _u, priority: _p, fill, style, alt = "", ...props }: ImageProps) {
	return (
		<img
			alt={alt}
			style={fill ? { ...style, position: "absolute", inset: 0, width: "100%", height: "100%" } : style}
			{...props}
		/>
	);
}
