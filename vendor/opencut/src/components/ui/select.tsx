// Misty: OpenCut's Select is Misty's; a separator between options is Misty's Separator.
import * as SelectPrimitive from "@radix-ui/react-select";
import { Separator } from "@/shared/ui";
import type { ComponentProps, ReactNode } from "react";
import { SelectItem as MistySelectItem } from "@/shared/ui";
import { forwardRef, type ElementRef } from "react";
import { SelectTrigger as MistySelectTrigger } from "@/shared/ui";
export { Select, SelectContent, SelectValue } from "@/shared/ui";

/** Misty's select trigger has one look; OpenCut's `variant` is not used. */
export const SelectTrigger = forwardRef<
	ElementRef<typeof MistySelectTrigger>,
	ComponentProps<typeof MistySelectTrigger> & { variant?: string }
>(({ variant: _variant, ...props }, ref) => <MistySelectTrigger ref={ref} {...props} />);
SelectTrigger.displayName = "SelectTrigger";

/** OpenCut gives an option its text as children; Misty's option takes it as its label. */
export function SelectItem({
	children,
	...props
}: Omit<ComponentProps<typeof MistySelectItem>, "label"> & { children?: ReactNode }) {
	return <MistySelectItem label={children} {...props} />;
}
export const SelectGroup = SelectPrimitive.Group;
export function SelectSeparator() {
	return (
		<SelectPrimitive.Separator asChild>
			<Separator className="my-1" />
		</SelectPrimitive.Separator>
	);
}
