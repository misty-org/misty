// Misty: OpenCut writes a tooltip as parts (Tooltip, TooltipTrigger, TooltipContent); Misty's
// Tooltip takes its words and the element it describes. This reads the parts and draws Misty's.
import {
	Children,
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { Tooltip as MistyTooltip, TooltipProvider, type TooltipSide } from "@/shared/ui";

type Side = TooltipSide;
type Align = "start" | "center" | "end";

export function TooltipTrigger({ children }: { children: ReactNode; asChild?: boolean }) {
	return <>{children}</>;
}

export function TooltipContent({
	children,
}: {
	children?: ReactNode;
	side?: Side;
	align?: Align;
	sideOffset?: number;
	className?: string;
	variant?: string;
	hidden?: boolean;
}) {
	return <>{children}</>;
}

/** The words inside a node, however it is wrapped. */
function textOf(node: ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
	return "";
}

export function Tooltip({
	children,
}: {
	children: ReactNode;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	delayDuration?: number;
}) {
	const parts = Children.toArray(children).filter(isValidElement) as ReactElement<{
		children?: ReactNode;
		side?: Side;
		align?: Align;
		hidden?: boolean;
	}>[];
	const trigger = parts.find((part) => part.type === TooltipTrigger);
	const content = parts.find((part) => part.type === TooltipContent);
	const target = trigger?.props.children;
	if (!isValidElement(target)) return <>{target ?? null}</>;
	const words = textOf(content?.props.children).trim();
	if (!words || content?.props.hidden) return target;
	// An icon-only control is named by its tooltip when it has no name of its own.
	const props = target.props as { "aria-label"?: string; children?: ReactNode };
	const named =
		props["aria-label"] || textOf(props.children).trim()
			? target
			: cloneElement(target as ReactElement<{ "aria-label"?: string }>, { "aria-label": words });
	return (
		<MistyTooltip
			content={words}
			side={content?.props.side}
			align={content?.props.align}
		>
			{named}
		</MistyTooltip>
	);
}

export { TooltipProvider };
