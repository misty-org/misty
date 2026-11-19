// Misty: OpenCut writes a menu row as an item with an icon prop and its label as children; Misty
// has one menu row, MenuItem (icon · label · shortcut), for dropdown and context menus alike.
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { MenuItem } from "@/shared/ui";

type MistyMenuItemProps = ComponentProps<typeof MenuItem>;

export type OpencutMenuItemProps = Omit<MistyMenuItemProps, "label" | "icon" | "ref"> & {
	icon?: ReactNode;
	inset?: boolean;
	/** A key hint at the row's end. */
	textRight?: ReactNode;
	variant?: "default" | "destructive" | "danger";
	children?: ReactNode;
};

export const OpencutMenuItem = forwardRef<HTMLDivElement, OpencutMenuItemProps>(
	({ icon, inset: _inset, textRight, variant, children, ...props }, ref) => (
		<MenuItem
			ref={ref}
			icon={icon as MistyMenuItemProps["icon"]}
			label={children}
			shortcut={textRight}
			danger={variant === "destructive" || variant === "danger"}
			{...props}
		/>
	),
);
OpencutMenuItem.displayName = "MenuItem";
