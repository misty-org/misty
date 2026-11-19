import { PlusSignIcon, RulerIcon } from "@opencut/components/icons/huge";
import { HugeiconsIcon } from "@opencut/components/icons/huge";
import { Button } from "@opencut/components/ui/button";
import type { GuideDefinition } from "@opencut/guides/types";

function CustomGuideOptions() {
	return (
		<div className="flex gap-2">
			<Button variant="outline" size="sm" className="flex-1">
				<HugeiconsIcon icon={PlusSignIcon} />
				Add guide line
			</Button>
		</div>
	);
}

export const customGuide = {
	id: "custom",
	label: "Custom",
	renderPreview: () => <HugeiconsIcon size={16} icon={RulerIcon} />,
	renderTriggerIcon: () => <HugeiconsIcon icon={RulerIcon} />,
	renderOverlay: () => null,
	renderOptions: () => <CustomGuideOptions />,
} as const satisfies GuideDefinition;
