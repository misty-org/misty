// Misty: a choice of one, drawn like Misty's Checkbox with a dot in place of the check.
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/shared/ui/classNames";

const RadioGroup = forwardRef<
	ElementRef<typeof RadioGroupPrimitive.Root>,
	ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
	<RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = forwardRef<
	ElementRef<typeof RadioGroupPrimitive.Item>,
	ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
	<RadioGroupPrimitive.Item
		ref={ref}
		className={cn(
			"grid size-4 shrink-0 place-content-center rounded-full border",
			"border-charcoal-border-strong outline-none transition-colors duration-150 ease-out",
			"hover:border-cream-muted focus-visible:border-cream",
			"disabled:cursor-not-allowed disabled:opacity-50",
			"data-[state=checked]:border-charcoal-active data-[state=checked]:bg-charcoal-active",
			className,
		)}
		{...props}
	>
		<RadioGroupPrimitive.Indicator className="size-1.5 rounded-full bg-cream-bright" />
	</RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
