"use client";

import { useEffect, useMemo, useState } from "react";
import { TransitionTopIcon } from "@opencut/components/icons/huge";
import { HugeiconsIcon } from "@opencut/components/icons/huge";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@opencut/components/ui/popover";
import { Button } from "@opencut/components/ui/button";
import { Label } from "@opencut/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@opencut/components/ui/radio-group";
import { Progress } from "@opencut/components/ui/progress";
import { Checkbox } from "@opencut/components/ui/checkbox";
import { cn } from "@opencut/utils/ui";
import {
	getExportMimeType,
	getExportFileExtension,
	downloadBuffer,
} from "@opencut/export";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportFormat,
	type ExportQuality,
} from "@opencut/export";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@opencut/components/section";
import { useEditor } from "@opencut/editor/use-editor";
import { DEFAULT_EXPORT_OPTIONS } from "@opencut/export/defaults";
import {
	canEncodeExportSize,
	defaultExportSize,
	EXPORT_SIZE_LABELS,
	exportSizeChoices,
	isExportSize,
	type ExportSize,
	type ExportSizeChoice,
} from "@opencut/export/sizes";

function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

/**
 * Misty: the export sizes this webview can encode in a format, once it has been asked; null
 * until then.
 */
function useEncodableSizes({
	format,
	choices,
}: {
	format: ExportFormat;
	choices: ExportSizeChoice[];
}): Set<ExportSize> | null {
	const [encodable, setEncodable] = useState<{
		key: string;
		sizes: Set<ExportSize>;
	} | null>(null);
	const key = `${format}:${choices.map((choice) => `${choice.size}=${choice.width}x${choice.height}`).join(",")}`;
	useEffect(() => {
		let live = true;
		Promise.all(
			choices.map(async (choice) => ({
				size: choice.size,
				ok: await canEncodeExportSize({ format, width: choice.width, height: choice.height }),
			})),
		).then((checked) => {
			if (!live) return;
			setEncodable({
				key,
				sizes: new Set(checked.filter((each) => each.ok).map((each) => each.size)),
			});
		});
		return () => {
			live = false;
		};
	}, [choices, format, key]);
	return encodable?.key === key ? encodable.sizes : null;
}

/** Misty: where an export can go besides a download, such as the Space's Media. */
export interface ExportDestination {
	label: string;
	save: (file: { blob: Blob; filename: string }) => Promise<void>;
}

export function ExportButton({ destination }: { destination?: ExportDestination } = {}) {
	const [isExportPopoverOpen, setIsExportPopoverOpen] = useState(false);
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const hasProject = !!activeProject;

	const handlePopoverOpenChange = ({ open }: { open: boolean }) => {
		if (!open) {
			editor.project.cancelExport();
			editor.project.clearExportState();
		}
		setIsExportPopoverOpen(open);
	};

	return (
		<Popover
			open={isExportPopoverOpen}
			onOpenChange={(open) => handlePopoverOpenChange({ open })}
		>
			<PopoverTrigger asChild>
				{/* Misty: the page's one primary button. */}
				<Button disabled={!hasProject}>
					<HugeiconsIcon icon={TransitionTopIcon} />
					Export
				</Button>
			</PopoverTrigger>
			{hasProject && (
				<ExportPopover onOpenChange={setIsExportPopoverOpen} destination={destination} />
			)}
		</Popover>
	);
}

function ExportPopover({
	onOpenChange,
	destination,
}: {
	onOpenChange: (open: boolean) => void;
	destination?: ExportDestination;
}) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const exportState = useEditor((e) => e.project.getExportState());
	const { isExporting, progress, result: exportResult } = exportState;
	const [format, setFormat] = useState<ExportFormat>(
		DEFAULT_EXPORT_OPTIONS.format,
	);
	const [quality, setQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_OPTIONS.quality,
	);
	const [shouldIncludeAudio, setShouldIncludeAudio] = useState<boolean>(
		DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
	);
	// Misty: the size to render at, keeping the project's shape; only sizes this webview can
	// encode are offered.
	const canvasWidth = activeProject?.settings.canvasSize.width ?? 0;
	const canvasHeight = activeProject?.settings.canvasSize.height ?? 0;
	const sizeChoices = useMemo(
		() => exportSizeChoices({ canvas: { width: canvasWidth, height: canvasHeight } }),
		[canvasWidth, canvasHeight],
	);
	const fallbackSize = defaultExportSize({
		canvas: { width: canvasWidth, height: canvasHeight },
	});
	const [pickedSize, setPickedSize] = useState<ExportSize | null>(null);
	const encodable = useEncodableSizes({ format, choices: sizeChoices });
	const shownSizes = sizeChoices.filter((choice) =>
		encodable ? encodable.has(choice.size) : choice.size === fallbackSize,
	);
	const sizeChoice =
		shownSizes.find((choice) => choice.size === pickedSize) ??
		sizeChoices.find((choice) => choice.size === fallbackSize);

	const [saveError, setSaveError] = useState("");
	const handleExport = async (to: "download" | "destination" = "download") => {
		if (!activeProject) return;
		setSaveError("");

		const result = await editor.project.export({
			options: {
				format,
				quality,
				fps: activeProject.settings.fps,
				includeAudio: shouldIncludeAudio,
				...(sizeChoice &&
					sizeChoice.size !== "project" && {
						size: { width: sizeChoice.width, height: sizeChoice.height },
					}),
			},
		});

		if (result.cancelled) {
			editor.project.clearExportState();
			return;
		}

		if (result.success && result.buffer) {
			const filename = `${activeProject.metadata.name}${getExportFileExtension({ format })}`;
			const mimeType = getExportMimeType({ format });
			if (to === "destination" && destination) {
				try {
					await destination.save({ blob: new Blob([result.buffer], { type: mimeType }), filename });
				} catch (error) {
					setSaveError(error instanceof Error ? error.message : "The video could not be saved.");
					return;
				}
			} else {
				downloadBuffer({ buffer: result.buffer, filename, mimeType });
			}

			editor.project.clearExportState();
			onOpenChange(false);
		}
	};

	const handleCancel = () => {
		editor.project.cancelExport();
	};

	return (
		<PopoverContent className="bg-oc-background mr-4 flex w-80 flex-col p-0">
			{exportResult && !exportResult.success ? (
				<ExportError
					error={exportResult.error || "Unknown error occurred"}
					onRetry={() => handleExport()}
				/>
			) : (
				<>
					<div className="flex items-center justify-between p-3 border-b">
						<h3 className="font-medium text-sm">
							{isExporting ? "Exporting project" : "Export project"}
						</h3>
					</div>

					<div className="flex flex-col gap-4">
						{!isExporting && (
							<>
								<div className="flex flex-col">
									<Section
										collapsible
										defaultOpen={false}
										showTopBorder={false}
									>
										<SectionHeader>
											<SectionTitle>Format</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={format}
												onValueChange={(value) => {
													if (isExportFormat(value)) {
														setFormat(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="mp4" id="mp4" />
													<Label htmlFor="mp4">
														MP4 (H.264) - Better compatibility
													</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="webm" id="webm" />
													<Label htmlFor="webm">
														WebM (VP9) - Smaller file size
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>Quality</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={quality}
												onValueChange={(value) => {
													if (isExportQuality(value)) {
														setQuality(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="low" id="low" />
													<Label htmlFor="low">Low - Smallest file size</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="medium" id="medium" />
													<Label htmlFor="medium">Medium - Balanced</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="high" id="high" />
													<Label htmlFor="high">High - Recommended</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="very_high" id="very_high" />
													<Label htmlFor="very_high">
														Very high - Largest file size
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									{/* Misty: the frame size, keeping the project's shape. */}
									{shownSizes.length > 1 && sizeChoice && (
										<Section collapsible defaultOpen={false}>
											<SectionHeader>
												<SectionTitle>Size</SectionTitle>
											</SectionHeader>
											<SectionContent>
												<RadioGroup
													value={sizeChoice.size}
													onValueChange={(value) => {
														if (isExportSize(value)) {
															setPickedSize(value);
														}
													}}
												>
													{shownSizes.map((choice) => (
														<div
															key={choice.size}
															className="flex items-center space-x-2"
														>
															<RadioGroupItem
																value={choice.size}
																id={`size-${choice.size}`}
															/>
															<Label htmlFor={`size-${choice.size}`}>
																{`${EXPORT_SIZE_LABELS[choice.size]} - ${choice.width}×${choice.height}`}
															</Label>
														</div>
													))}
												</RadioGroup>
											</SectionContent>
										</Section>
									)}

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>Audio</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<div className="flex items-center space-x-2">
												<Checkbox
													id="include-audio"
													checked={shouldIncludeAudio}
													onCheckedChange={(checked) =>
														setShouldIncludeAudio(!!checked)
													}
												/>
												<Label htmlFor="include-audio">
													Include audio in export
												</Label>
											</div>
										</SectionContent>
									</Section>
								</div>

								<div className="flex flex-col gap-2 p-3 pt-0">
									{saveError && (
										<p role="alert" className="text-oc-destructive text-sm">
											{saveError}
										</p>
									)}
									{destination ? (
										<div className="flex gap-2">
											<Button variant="outline" onClick={() => handleExport("download")}>
												<Download />
												Download
											</Button>
											<Button onClick={() => handleExport("destination")} className="flex-1">
												{destination.label}
											</Button>
										</div>
									) : (
										<Button onClick={() => handleExport()} className="w-full gap-2">
											<Download />
											Export
										</Button>
									)}
								</div>
							</>
						)}

						{isExporting && (
							<div className="space-y-4 p-3">
								<div className="flex flex-col gap-2">
									<div className="flex items-center justify-between text-center">
										<p className="text-oc-muted-foreground text-sm">
											{Math.round(progress * 100)}%
										</p>
										<p className="text-oc-muted-foreground text-sm">100%</p>
									</div>
									<Progress value={progress * 100} className="w-full" />
								</div>

								<Button
									variant="outline"
									className="w-full rounded-md"
									onClick={handleCancel}
								>
									Cancel
								</Button>
							</div>
						)}
					</div>
				</>
			)}
		</PopoverContent>
	);
}

function ExportError({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(error);
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="space-y-4 p-3">
			<div className="flex flex-col gap-1.5">
				<p className="text-oc-destructive text-sm font-medium">Export failed</p>
				<p className="text-oc-muted-foreground text-xs">{error}</p>
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <Check className="text-oc-constructive" /> : <Copy />}
					Copy
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetry}
				>
					<RotateCcw />
					Retry
				</Button>
			</div>
		</div>
	);
}
