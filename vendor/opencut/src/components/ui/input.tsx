// Misty: OpenCut's Input drawn by Misty's. OpenCut's small sizes become Misty's compact field; a
// clear button, when asked for, is Misty's IconButton at the field's end.
import { X } from "lucide-react";
import { forwardRef, type ComponentProps } from "react";
import { IconButton, Input as MistyInput } from "@/shared/ui";
import { cn } from "@/shared/ui/classNames";

type MistyInputProps = ComponentProps<typeof MistyInput>;

export interface InputProps extends Omit<MistyInputProps, "size" | "variant"> {
	size?: "default" | "sm" | "xs" | "lg" | null;
	variant?: string | null;
	showPassword?: boolean;
	onShowPasswordChange?: (show: boolean) => void;
	showClearIcon?: boolean;
	onClear?: () => void;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
	(
		{
			size,
			variant: _variant,
			showPassword: _showPassword,
			onShowPasswordChange: _onShowPasswordChange,
			showClearIcon,
			onClear,
			containerClassName,
			...props
		},
		ref,
	) => {
		const compact = size === "sm" || size === "xs";
		const field = (
			<MistyInput
				ref={ref}
				variant={compact ? "compact" : "default"}
				containerClassName={containerClassName}
				{...props}
			/>
		);
		const hasValue = props.value !== undefined && String(props.value) !== "";
		if (!showClearIcon || !onClear) return field;
		return (
			<div className={cn("relative w-full min-w-0", containerClassName)}>
				{field}
				{hasValue && (
					<span className="absolute inset-y-0 right-1 flex items-center">
						<IconButton label="Clear" variant="quiet" size="sm" onClick={onClear}>
							<X aria-hidden="true" />
						</IconButton>
					</span>
				)}
			</div>
		);
	},
);
Input.displayName = "Input";

export { Input };
