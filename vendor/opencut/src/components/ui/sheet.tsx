// Misty: OpenCut's Sheet is Misty's; its trigger, header and footer are the plain parts.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { forwardRef, type ComponentProps, type ElementRef } from "react";
import { SheetContent as MistySheetContent } from "@/shared/ui";
export { Sheet, SheetDescription, SheetTitle } from "@/shared/ui";

/** Opens over the editor without darkening it (Misty never dims the panels beside a popup). */
export const SheetContent = forwardRef<
	ElementRef<typeof MistySheetContent>,
	ComponentProps<typeof MistySheetContent>
>(({ overlay = false, ...props }, ref) => <MistySheetContent ref={ref} overlay={overlay} {...props} />);
SheetContent.displayName = "SheetContent";
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export function SheetHeader({ children }: { children?: ReactNode; className?: string }) {
	return <div className="grid gap-1 px-4 pt-4">{children}</div>;
}
export function SheetFooter({ children }: { children?: ReactNode; className?: string }) {
	return <div className="flex justify-end gap-2 px-4 pb-4">{children}</div>;
}
