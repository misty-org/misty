import { Button } from "@opencut/components/ui/button";
import { HugeiconsIcon } from "@opencut/components/icons/huge";
import { KeyframeIcon } from "@opencut/components/icons/huge";
import { cn } from "@opencut/utils/ui";

export function KeyframeToggle({
	isActive,
	isDisabled = false,
	title,
	onToggle,
}: {
	isActive: boolean;
	isDisabled?: boolean;
	title: string;
	onToggle: () => void;
}) {
	return (
		<Button
			variant="text"
			aria-pressed={isActive}
			disabled={isDisabled}
			title={title}
			onClick={onToggle}
			className="[&>svg]:size-3.5 mb-0.5"
		>
			<HugeiconsIcon
				icon={KeyframeIcon}
				className={cn(isActive && "text-oc-primary fill-oc-primary")}
			/>
		</Button>
	);
}
