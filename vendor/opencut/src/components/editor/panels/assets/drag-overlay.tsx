import { HugeiconsIcon } from "@opencut/components/icons/huge";
import { UploadIcon } from "@opencut/components/icons/huge";

interface MediaDragOverlayProps {
	isVisible: boolean;
	isProcessing?: boolean;
	progress?: number;
	onClick?: () => void;
}

export function MediaDragOverlay({
	isVisible,
	isProcessing = false,
	progress = 0,
	onClick,
}: MediaDragOverlayProps) {
	if (!isVisible) return null;

	const handleClick = ({
		event,
	}: {
		event: React.MouseEvent<HTMLButtonElement>;
	}) => {
		if (isProcessing || !onClick) return;
		event.preventDefault();
		event.stopPropagation();
		onClick();
	};

	return (
		<button
			className="bg-oc-foreground/5 hover:bg-oc-foreground/10 flex flex-col items-center justify-center gap-4 rounded-lg p-8 text-center"
			type="button"
			disabled={isProcessing || !onClick}
			onClick={(event) => handleClick({ event })}
		>
			<div className="flex items-center justify-center">
				<HugeiconsIcon icon={UploadIcon} className="text-oc-foreground size-10" />
			</div>

			<div className="space-y-2">
				<p className="text-oc-muted-foreground max-w-sm text-xs">
					{isProcessing
						? `Processing your files (${progress}%)`
						: "Drag and drop videos, photos, and audio files here"}
				</p>
			</div>

			{isProcessing && (
				<div className="w-full max-w-xs">
					<div className="bg-oc-muted/50 h-2 w-full rounded-full">
						<div
							className="bg-oc-primary h-2 rounded-full"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>
			)}
		</button>
	);
}
