// Misty: the Sounds tab lists the Space's own audio files. OpenCut's searched Freesound through
// a key on OpenCut's server; Misty holds no keys and uses no outside sound library. Adding a
// sound puts its file in the project, on an audio track at the playhead. Its ⋯ menu also lays it
// under the whole video as music, and cuts the video to its beat (sounds/music-tools.ts).
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Music, Pause, Play, Plus, Scissors } from "lucide-react";
import { Button } from "@opencut/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@opencut/components/ui/dropdown-menu";
import { PanelView } from "@opencut/components/editor/panels/assets/views/base-panel";
import { toast } from "@opencut/components/toast";
import { EditorCore } from "@opencut/core";
import { useEditor } from "@opencut/editor/use-editor";
import { processMediaAssets } from "@opencut/media/processing";
import { useSpaceMedia, type SpaceMediaFile } from "@opencut/media/space-media";
import { buildElementFromMedia } from "@opencut/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@opencut/timeline/creation";
import { mediaTimeFromSeconds } from "@opencut/wasm";
import { useMusicTools } from "@opencut/sounds/music-tools";

/** Adds one of the Space's audio files to the project and to the timeline at the playhead. */
export async function addSpaceSound(file: File): Promise<void> {
	const editor = EditorCore.getInstance();
	const project = editor.project.getActive();
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) throw new Error(`“${file.name}” could not be read as audio.`);
	const asset = await editor.media.addMediaAsset({
		projectId: project.metadata.id,
		asset: processed,
	});
	if (!asset) throw new Error(`“${file.name}” could not be added.`);
	editor.timeline.insertElement({
		placement: { mode: "auto", trackType: "audio" },
		element: buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: asset.name,
			duration:
				asset.duration != null
					? mediaTimeFromSeconds({ seconds: asset.duration })
					: DEFAULT_NEW_ELEMENT_DURATION,
			startTime: editor.playback.getCurrentTime(),
		}),
	});
}

/** The names of the sounds the timeline plays on its audio tracks, in order. */
function soundsOnTimeline(editor: EditorCore): string[] {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return [];
	const used = new Set(
		tracks.audio.flatMap((track) =>
			track.elements.flatMap((element) =>
				element.sourceType === "upload" ? [element.mediaId] : [],
			),
		),
	);
	return editor.media
		.getAssets()
		.filter((asset) => used.has(asset.id))
		.map((asset) => asset.name)
		.sort();
}

export function SpaceSoundsView() {
	const spaceMedia = useSpaceMedia();
	const [sounds, setSounds] = useState<SpaceMediaFile[] | null>(null);
	const [failure, setFailure] = useState("");
	const [playing, setPlaying] = useState<string | null>(null);
	const [adding, setAdding] = useState<string | null>(null);
	const audio = useRef<HTMLAudioElement | null>(null);
	const urls = useRef(new Map<string, string>());
	const music = useMusicTools();
	const onTimeline = useEditor(soundsOnTimeline);

	useEffect(() => {
		if (!spaceMedia) return;
		let live = true;
		spaceMedia.listAudio().then(
			(found) => live && setSounds(found),
			(reason: unknown) =>
				live && setFailure(reason instanceof Error ? reason.message : "Sounds could not be read."),
		);
		return () => {
			live = false;
		};
	}, [spaceMedia]);

	useEffect(() => {
		const known = urls.current;
		return () => {
			audio.current?.pause();
			for (const url of known.values()) URL.revokeObjectURL(url);
		};
	}, []);

	if (!spaceMedia) return <PanelView title="Sounds">{null}</PanelView>;

	const fileOf = async (sound: SpaceMediaFile) => spaceMedia.load(sound.id);

	const togglePlay = async (sound: SpaceMediaFile) => {
		if (playing === sound.id) {
			audio.current?.pause();
			setPlaying(null);
			return;
		}
		let url = urls.current.get(sound.id);
		if (!url) {
			url = URL.createObjectURL(await fileOf(sound));
			urls.current.set(sound.id, url);
		}
		audio.current?.pause();
		const player = new Audio(url);
		player.onended = () => setPlaying(null);
		audio.current = player;
		await player.play();
		setPlaying(sound.id);
	};

	/** Runs one of a sound's actions, with the sound's menu off until it is done. */
	const run = async (
		sound: SpaceMediaFile,
		work: (file: File) => Promise<void>,
		failure = "The sound could not be added.",
	) => {
		setAdding(sound.id);
		try {
			await work(await fileOf(sound));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : failure);
		} finally {
			setAdding(null);
		}
	};

	return (
		<PanelView title="Sounds">
			{failure ? (
				<p role="alert" className="text-oc-destructive px-1 pt-2 text-sm">
					{failure}
				</p>
			) : sounds === null ? null : sounds.length === 0 ? (
				<p className="text-oc-muted-foreground px-1 pt-2 text-sm">
					Audio files added to this Space's Media show here.
				</p>
			) : (
				<ul className="grid gap-1 pt-1">
					{sounds.map((sound) => (
						<li key={sound.id} className="flex items-center gap-2">
							<Button
								size="icon"
								variant="ghost"
								aria-label={playing === sound.id ? `Pause ${sound.name}` : `Play ${sound.name}`}
								onClick={() => void togglePlay(sound)}
							>
								{playing === sound.id ? <Pause /> : <Play />}
							</Button>
							<span className="min-w-0 flex-1 truncate text-sm">{sound.name}</span>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										size="icon"
										variant="ghost"
										aria-label={`${sound.name} options`}
										disabled={adding === sound.id}
									>
										<MoreHorizontal />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem
										icon={<Plus />}
										onSelect={() => void run(sound, addSpaceSound)}
									>
										Add at the playhead
									</DropdownMenuItem>
									{music && (
										<DropdownMenuItem
											icon={<Music />}
											onSelect={() =>
												void run(sound, (file) =>
													music.addAsMusic({ id: sound.id, name: sound.name, file }),
												)
											}
										>
											Add as music
										</DropdownMenuItem>
									)}
									{music && onTimeline.includes(sound.name) && (
										<DropdownMenuItem
											icon={<Scissors />}
											onSelect={() =>
												void run(
													sound,
													(file) => music.cutToBeat({ id: sound.id, name: sound.name, file }),
													"The video could not be cut to the beat.",
												)
											}
										>
											Cut to the beat
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						</li>
					))}
				</ul>
			)}
		</PanelView>
	);
}
