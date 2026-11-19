// Misty: a notice inside a panel, on Misty's surfaces and text tones.
import type { ReactNode } from "react";
import { Surface, Text } from "@/shared/ui";

export function Alert({
	variant,
	className,
	children,
}: {
	variant?: "default" | "destructive";
	className?: string;
	children?: ReactNode;
}) {
	return (
		<Surface
			role="alert"
			tone={variant === "destructive" ? "removed" : "well"}
			className={["grid gap-1 rounded-lg px-3 py-2", className].filter(Boolean).join(" ")}
		>
			{children}
		</Surface>
	);
}

export function AlertTitle({ children }: { children?: ReactNode; className?: string }) {
	return (
		<Text as="p" size="control" weight="medium" tone="default">
			{children}
		</Text>
	);
}

export function AlertDescription({ children }: { children?: ReactNode; className?: string }) {
	return (
		<Text as="div" size="control" tone="muted">
			{children}
		</Text>
	);
}
