import type { ReactNode } from "react";
import type * as Y from "yjs";
import type { VideoProjectDocument } from "./projectDocumentTypes";

/** Where an exported video can be saved besides a download, such as the Space's Media. */
export interface VideoDestination {
  /** The button's words, such as "Save to Media". */
  label: string;
  save(file: { blob: Blob; filename: string }): Promise<void>;
}

/** The Space a video is edited in: its Media to add photos, videos and sounds from. */
export interface VideoSpaceMedia {
  spaceId: string;
  /** The Space's audio files, newest first. */
  listAudio(): Promise<Array<{ id: string; name: string }>>;
  /** Reads one of the Space's files. */
  load(itemId: string): Promise<File>;
}

/** A video project kept in a Space, which the editor saves as it changes. */
export interface VideoProjectSource {
  /** Reads the project as kept. */
  load(): Promise<VideoProjectDocument>;
  /** Reads one of the Media items the project uses. */
  loadMedia(itemId: string): Promise<File>;
  /** Media items to lay on the timeline, in order, when a new project first opens. */
  startWith?: string[];
  /** Keeps the project as it is now. */
  keep(document: VideoProjectDocument): Promise<void>;
  /** Adds a file the project uses to Media (one imported from the computer); its item's id. */
  keepMedia(file: File): Promise<string>;
  /** The project's live room, shared with everyone (and every agent) with it open. */
  room?: Y.Doc;
}

export interface VideoEditorProps {
  /** The video's name: the opened file's or project's, shown in the bar, given to the export. */
  name: string;
  /** Reads the file the video starts from, for a video opened from a file. */
  loadSource?(): Promise<File>;
  /** The project the video is, for a video project kept in Media. */
  project?: VideoProjectSource;
  destination?: VideoDestination;
  /** The Agent tab: a chat with the person's agent about this video, where one can work on it. */
  agentPanel?: ReactNode;
  /** The Space's Media, for the editor's Media and Sounds tabs. */
  spaceMedia?: VideoSpaceMedia;
  /**
   * Turns recorded speech into words with their times (seconds), on this computer, for the
   * captions tab; left out where the computer can't, and the tab offers no captions to make.
   */
  transcribe?(
    audio: Blob,
    language?: string,
  ): Promise<Array<{ text: string; start: number; end: number }>>;
  onClose(): void;
}
