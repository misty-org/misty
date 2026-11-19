// Misty: OpenCut's Button, drawn by Misty's Button. OpenCut's variants map onto Misty's four
// roles (primary, secondary, quiet, danger) and its sizes onto Misty's three; an icon-only button
// is Misty's IconButton, named by its aria-label or title.
import { forwardRef, type ButtonHTMLAttributes } from "react";
import {
	Button as MistyButton,
	IconButton,
	type ButtonVariant,
	type ButtonSize,
} from "@/shared/ui";

type OpencutVariant =
	| "default"
	| "background"
	| "destructive"
	| "destructive-foreground"
	| "caution"
	| "outline"
	| "secondary"
	| "text"
	| "ghost"
	| "link";
type OpencutSize = "default" | "sm" | "lg" | "icon" | "text";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: OpencutVariant | null;
	size?: OpencutSize | null;
	asChild?: boolean;
}

const variants: Record<OpencutVariant, ButtonVariant> = {
	default: "primary",
	background: "secondary",
	destructive: "danger",
	"destructive-foreground": "danger",
	caution: "quiet",
	outline: "secondary",
	secondary: "secondary",
	text: "quiet",
	ghost: "quiet",
	link: "quiet",
};

const sizes: Record<Exclude<OpencutSize, "icon">, ButtonSize> = {
	default: "md",
	sm: "sm",
	lg: "lg",
	text: "sm",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ variant, size, asChild, children, ...props }, ref) => {
		const role = variants[variant ?? "default"];
		if (size === "icon" && !asChild) {
			const label = String(props["aria-label"] ?? props.title ?? "");
			return (
				<IconButton
					ref={ref}
					label={label}
					variant={role === "primary" ? "secondary" : role}
					{...props}
				>
					{children}
				</IconButton>
			);
		}
		return (
			<MistyButton
				ref={ref}
				variant={role}
				size={sizes[size === "icon" || !size ? "default" : size]}
				asChild={asChild}
				{...props}
			>
				{children}
			</MistyButton>
		);
	},
);
Button.displayName = "Button";

export { Button };
