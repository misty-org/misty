import { Button } from "@opencut/components/ui/button";
import { PanelView } from "@opencut/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@opencut/components/ui/select";
import { useReducer, useRef, useState, useSyncExternalStore } from "react";
import { extractTimelineAudio } from "@opencut/media/mediabunny";
import { useEditor } from "@opencut/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@opencut/transcription/diagnostics";
import { TRANSCRIPTION_LANGUAGES } from "@opencut/transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@opencut/transcription/types";
import {
	canTranscribe,
	onTranscriberChange,
	transcriptionService,
} from "@opencut/services/transcription/service";
import { captionChunksFromPhrases } from "@opencut/transcription/group-words";
import { insertCaptionChunksAsTextTrack } from "@opencut/subtitles/insert";
import {
	CAPTION_STYLES,
	DEFAULT_CAPTION_STYLE,
	isCaptionStyle,
	type CaptionStyle,
} from "@opencut/subtitles/caption-style";
import {
	captionRestyleUpdates,
	captionTrackStyle,
} from "@opencut/subtitles/restyle";
import { UpdateElementsCommand } from "@opencut/commands";
import { parseSubtitleFile } from "@opencut/subtitles/parse";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@opencut/components/section";
import { AlertCircleIcon, CloudUploadIcon } from "@opencut/components/icons/huge";
import { HugeiconsIcon } from "@opencut/components/icons/huge";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@opencut/components/ui/tooltip";
import type { DiagnosticSeverity } from "@opencut/diagnostics/types";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	// Misty: the caption style, for new captions and the ones on the timeline.
	const [chosenStyle, setChosenStyle] =
		useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor();

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);
	const trackStyle = useEditor((e) =>
		captionTrackStyle({ tracks: e.scenes.getActiveSceneOrNull()?.tracks }),
	);
	const captionStyle = trackStyle ?? chosenStyle;

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			dispatch({
				type: "update_step",
				step: `Loading model ${Math.round(progress.progress)}%`,
			});
		} else if (progress.status === "transcribing") {
			dispatch({ type: "update_step", step: "Transcribing..." });
		}
	};

	const insertCaptions = ({
		captions,
	}: {
		captions: CaptionChunk[];
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({
			editor,
			captions,
			captionStyle,
		});
		return trackId !== null;
	};

	const transcribable = useSyncExternalStore(onTranscriberChange, canTranscribe, canTranscribe);

	const handleGenerateTranscript = async () => {
		dispatch({ type: "start", step: "Extracting audio..." });
		try {
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			const result = await transcriptionService.transcribe({
				audioBlob,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				onProgress: handleProgress,
			});

			dispatch({ type: "update_step", step: "Generating captions..." });
			// Misty: phrases keep their words' times, for karaoke.
			const captionChunks = captionChunksFromPhrases({
				segments: result.segments,
			});

			if (!insertCaptions({ captions: captionChunks })) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			dispatch({ type: "succeed", warnings: [] });
		} catch (error) {
			console.error("Transcription failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: "Reading subtitle file..." });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			dispatch({ type: "update_step", step: "Importing subtitles..." });

			if (!insertCaptions({ captions: result.captions })) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`Imported ${result.captions.length} subtitle cue(s) and skipped ${result.skippedCueCount} malformed cue(s).`,
				);
			}

			dispatch({ type: "succeed", warnings: nextWarnings });
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	// Misty: a new style applies to the captions on the timeline too, as one undo step.
	const handleStyleChange = ({ value }: { value: string }) => {
		if (!isCaptionStyle(value)) return;
		setChosenStyle(value);
		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) return;
		const updates = captionRestyleUpdates({
			tracks: scene.tracks,
			style: value,
			canvasSize: editor.project.getActive().settings.canvasSize,
		});
		if (updates.length === 0) return;
		editor.command.execute({
			command: new UpdateElementsCommand({
				updates: updates.map(({ trackId, elementId, params }) => ({
					trackId,
					elementId,
					patch: { params },
				})),
			}),
		});
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title="Captions"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							Import
						</Button>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label="Language">
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a language" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto detect</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField label="Style">
							<Select
								value={captionStyle}
								onValueChange={(value) => handleStyleChange({ value })}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_STYLES.map((style) => (
										<SelectItem key={style.value} value={style.value}>
											{style.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					</SectionFields>

					{/* Misty: shown only where this computer can recognize speech; busy, the button is
					    just disabled and the step shows beside it. */}
					{transcribable && (
						<div className="mt-auto grid gap-2">
							{isProcessing && (
								<p role="status" className="text-oc-muted-foreground text-sm">
									{processing.step}
								</p>
							)}
							<Button
								type="button"
								className="w-full"
								onClick={handleGenerateTranscript}
								disabled={isProcessing || activeDiagnostics.length > 0}
							>
								Generate captions
							</Button>
						</div>
					)}
					{error && (
						<div className="bg-oc-destructive/10 border-oc-destructive/20 rounded-md border p-3">
							<p className="text-oc-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}
