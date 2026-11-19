"use client";

// Misty: a motion graphic's properties: a field for each of its props, then its script, with
// the error the script last hit beside it.
import { useEffect, useState } from "react";
import type { ParamDefinition, ParamValue } from "@opencut/params";
import type { GraphicElement } from "@opencut/timeline";
import { useEditor } from "@opencut/editor/use-editor";
import { useElementPreview } from "@opencut/timeline/hooks/use-element-preview";
import {
	Section,
	SectionContent,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@opencut/components/section";
import { PropertyParamField } from "@opencut/components/editor/panels/properties/components/property-param-field";
import { Textarea } from "@opencut/components/ui/textarea";
import { readMotionScript } from "../definition";
import { useMotionError } from "../errors";
import {
	checkMotionProp,
	motionPropLabel,
	readMotionProps,
	serializeMotionProps,
	type MotionPropDeclaration,
	type MotionProps,
} from "../props";
import { checkMotionScript, isMotionRuntimeReady, loadMotionRuntime } from "../runtime";

const LOWEST_NUMBER = -1_000_000_000;

function fieldFor({
	name,
	declaration,
}: {
	name: string;
	declaration: MotionPropDeclaration;
}): ParamDefinition {
	const label = motionPropLabel(name, declaration);
	if (declaration.type === "number") {
		const value = Number(declaration.value);
		return {
			key: name,
			label,
			type: "number",
			default: value,
			min: declaration.min ?? LOWEST_NUMBER,
			max: declaration.max,
			step: declaration.step ?? (Number.isInteger(value) ? 1 : 0.01),
			keyframable: false,
		};
	}
	if (declaration.type === "color") {
		return {
			key: name,
			label,
			type: "color",
			default: String(declaration.value),
			keyframable: false,
		};
	}
	return {
		key: name,
		label,
		type: "text",
		default: String(declaration.value),
		keyframable: false,
	};
}

/** The props with one value changed, or null when the value doesn't fit the prop. */
function withValue({
	props,
	name,
	value,
}: {
	props: MotionProps;
	name: string;
	value: ParamValue;
}): MotionProps | null {
	const declaration = props[name];
	if (!declaration) return null;
	try {
		return { ...props, [name]: checkMotionProp(name, { ...declaration, value }) };
	} catch {
		return null;
	}
}

function useMotionRuntimeReady(): boolean {
	const [ready, setReady] = useState(isMotionRuntimeReady());
	useEffect(() => {
		if (ready) return;
		let live = true;
		loadMotionRuntime().then(
			() => live && setReady(true),
			() => undefined,
		);
		return () => {
			live = false;
		};
	}, [ready]);
	return ready;
}

export function MotionTab({
	element,
	trackId,
}: {
	element: GraphicElement;
	trackId: string;
}) {
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const live = renderElement as GraphicElement;
	const props = readMotionProps(live.params.props);
	const names = Object.keys(props);

	return (
		<div className="flex flex-col">
			{names.length > 0 && (
				<Section collapsible sectionKey={`${element.id}:motion-props`}>
					<SectionHeader>
						<SectionTitle>Motion graphic</SectionTitle>
					</SectionHeader>
					<SectionContent>
						<SectionFields>
							{names.map((name) => (
								<PropertyParamField
									key={name}
									param={fieldFor({ name, declaration: props[name] })}
									value={props[name].value}
									onPreview={(value) => {
										const next = withValue({ props, name, value });
										if (!next) return;
										previewUpdates({
											params: { ...live.params, props: serializeMotionProps(next) },
										});
									}}
									onCommit={commit}
								/>
							))}
						</SectionFields>
					</SectionContent>
				</Section>
			)}
			<ScriptSection element={element} trackId={trackId} hasProps={names.length > 0} />
		</div>
	);
}

function ScriptSection({
	element,
	trackId,
	hasProps,
}: {
	element: GraphicElement;
	trackId: string;
	hasProps: boolean;
}) {
	const editor = useEditor();
	const ready = useMotionRuntimeReady();
	const script = readMotionScript(element.params);
	const [draft, setDraft] = useState(script);
	useEffect(() => setDraft(script), [script]);
	const drawError = useMotionError({ script });
	const error = drawError ?? (ready ? checkMotionScript(script) : null);

	const save = () => {
		if (draft === script) return;
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: { params: { ...element.params, script: draft } },
				},
			],
		});
	};

	return (
		<Section
			collapsible
			defaultOpen={!hasProps || Boolean(error)}
			sectionKey={`${element.id}:motion-script`}
		>
			<SectionHeader>
				<SectionTitle>Script</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<div className="flex flex-col gap-2">
					<Textarea
						variant="code"
						aria-label="Script"
						aria-invalid={error ? true : undefined}
						value={draft}
						onChange={(event) => setDraft(event.currentTarget.value)}
						onBlur={save}
					/>
					{error && (
						<p role="alert" className="text-oc-destructive text-sm">
							{error}
						</p>
					)}
				</div>
			</SectionContent>
		</Section>
	);
}
