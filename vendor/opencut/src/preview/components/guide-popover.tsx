"use client";

import { GUIDE_REGISTRY, getGuideById } from "@opencut/guides";
import { usePreviewStore } from "@opencut/preview/preview-store";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@opencut/components/ui/popover";
import { Label } from "@opencut/components/ui/label";
import { Separator } from "@opencut/components/ui/separator";
import { cn } from "@opencut/utils/ui";

export function GridPopover({ children }: { children: React.ReactNode }) {
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const toggleGuide = usePreviewStore((state) => state.toggleGuide);
	const activeGuideDef = getGuideById(activeGuide);
	const options = activeGuideDef?.renderOptions?.();

	return (
		<Popover>
			<PopoverTrigger>{children}</PopoverTrigger>
			<PopoverContent sideOffset={8} className="w-60 px-0">
				<div className="flex flex-col gap-2 px-4">
					<Label>Guides</Label>
					<div className="grid grid-cols-3 gap-1">
						{GUIDE_REGISTRY.map((guide) => (
							<GridItem
								key={guide.id}
								label={guide.label}
								preview={guide.renderPreview()}
								isSelected={activeGuide === guide.id}
								onClick={() => toggleGuide(guide.id)}
							/>
						))}
					</div>
				</div>
				{options && (
					<div className="overflow-hidden">
						<Separator className="my-3" />
						<div className="px-4">{options}</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

function GridItem({
	label,
	preview,
	isSelected,
	onClick,
}: {
	label: string;
	preview: React.ReactNode;
	isSelected?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={isSelected}
			className={cn(
				"flex cursor-pointer rounded-sm flex-col gap-2 px-1.5 py-1.5 hover:bg-oc-foreground/5",
				isSelected && "bg-oc-primary/5! text-oc-primary",
			)}
		>
			<div
				className={cn(
					"aspect-video bg-oc-foreground/5 flex items-center justify-center rounded-sm",
					isSelected && "bg-oc-primary/5!",
				)}
			>
				{preview}
			</div>
			<span
				className={cn(
					"text-xs",
					isSelected ? "text-oc-primary" : "text-oc-muted-foreground",
				)}
			>
				{label}
			</span>
		</button>
	);
}
