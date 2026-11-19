import { HugeiconsIcon } from "@opencut/components/icons/huge";
import { Settings05Icon } from "@opencut/components/icons/huge";

export function EmptyView() {
	return (
		<div className="bg-oc-background flex h-full flex-col items-center justify-center gap-3 p-4">
			<HugeiconsIcon
				icon={Settings05Icon}
				className="text-oc-muted-foreground/75 size-10"
				strokeWidth={1}
			/>
			<div className="flex flex-col gap-2 text-center">
				<p className="text-lg font-medium ">It's empty here</p>
				<p className="text-oc-muted-foreground text-sm text-balance">
					Click an element on the timeline to edit its properties
				</p>
			</div>
		</div>
	);
}
