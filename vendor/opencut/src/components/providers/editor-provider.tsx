"use client";

import { useEffect, useState } from "react";
import { Skeleton, Text } from "@/shared/ui";
import { EditorCore } from "@opencut/core";
import { useEditor } from "@opencut/editor/use-editor";
import { useKeybindingsListener } from "@opencut/actions/use-keybindings";
import { useKeybindingsStore } from "@opencut/actions/keybindings-store";
import { useTimelineStore } from "@opencut/timeline/timeline-store";
import { useEditorActions } from "@opencut/actions/use-editor-actions";
import { loadFontAtlas } from "@opencut/fonts/google-fonts";
import {
	initializeGpuRenderer,
	isGpuAvailable,
} from "@opencut/services/renderer/gpu-renderer";

interface EditorProviderProps {
	projectId: string;
	children: React.ReactNode;
	/** Misty: a project that wasn't found was made anew under this id. */
	onProjectCreated?: (projectId: string) => void;
}

export function EditorProvider({ projectId, children, onProjectCreated }: EditorProviderProps) {
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const { setLoadingProject } = useKeybindingsStore();

	useEffect(() => {
		setLoadingProject(isLoading);
	}, [isLoading, setLoadingProject]);

	useEffect(() => {
		let cancelled = false;
		const editor = EditorCore.getInstance();

		const loadProject = async () => {
			try {
				setIsLoading(true);
				await initializeGpuRenderer();
				editor.renderer.setDegraded(!isGpuAvailable());
				await editor.project.loadProject({ id: projectId });

				if (cancelled) return;

				setIsLoading(false);
				loadFontAtlas();
			} catch (err) {
				if (cancelled) return;

				const isNotFound =
					err instanceof Error &&
					(err.message.includes("not found") ||
						err.message.includes("does not exist"));

				if (isNotFound) {
					try {
						const newProjectId = await editor.project.createNewProject({
							name: "Untitled Project",
						});
						onProjectCreated?.(newProjectId);
					} catch (_createErr) {
						setError("Failed to create project");
						setIsLoading(false);
					}
				} else {
					const wasmPanic = (window as Window & { __wasmPanic?: string })
						.__wasmPanic;
					if (wasmPanic) {
						delete (window as Window & { __wasmPanic?: string }).__wasmPanic;
						setError(wasmPanic);
					} else {
						setError(
							err instanceof Error ? err.message : "Failed to load project",
						);
					}
					setIsLoading(false);
				}
			}
		};

		loadProject();

		return () => {
			cancelled = true;
		};
	}, [projectId, onProjectCreated]);

	// Misty: a failure says what failed; opening shows the editor's shape, never a loading word.
	if (error) {
		return (
			<div className="flex size-full items-center justify-center">
				<Text as="p" size="control" tone="danger">
					{error}
				</Text>
			</div>
		);
	}

	if (isLoading || !activeProject) {
		return (
			<div role="status" aria-label="Opening the video" className="flex size-full flex-col gap-1 p-3">
				<div className="flex min-h-0 flex-[3] gap-1">
					<Skeleton className="w-1/5 rounded-lg" />
					<Skeleton className="flex-1 rounded-lg" />
					<Skeleton className="w-1/5 rounded-lg" />
				</div>
				<Skeleton className="min-h-0 flex-[2] rounded-lg" />
			</div>
		);
	}

	return (
		<>
			<EditorRuntimeBindings />
			{children}
		</>
	);
}

function EditorRuntimeBindings() {
	const editor = useEditor();
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);

	useEffect(() => {
		editor.command.isRippleEnabled = rippleEditingEnabled;
	}, [editor, rippleEditingEnabled]);

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!editor.save.getIsDirty()) return;
			event.preventDefault();
			(event as unknown as { returnValue: string }).returnValue = "";
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [editor]);

	useEditorActions();
	useKeybindingsListener();
	return null;
}
