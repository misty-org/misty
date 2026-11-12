/**
 * Tutor: a place to learn with agents. Notebooks gather sources and notes; agents turn them into
 * guides, flashcards, quizzes and lessons. Everything here lives on this computer in misty.db,
 * beside the chats, and never syncs.
 */

/** How much of a source a notebook's agent runs get: none, its summary, or all of it. */
export type SourceContext = "off" | "summary" | "full";

export type SourceKind = "text" | "link" | "file" | "recording";

export interface NotebookSource {
  id: string;
  kind: SourceKind;
  title: string;
  /** A link's address. */
  url?: string;
  /** Pasted text, or what a file's pages read as. A link's text is read by the agent itself. */
  text?: string;
  /** A file's type, as the document reader names it. */
  mimeType?: string;
  /** Written by an agent when asked; sent instead of the text when context is "summary". */
  summary?: string;
  context: SourceContext;
  /** The file's text was cut to fit. */
  truncated?: boolean;
  /** A link whose text Misty is reading now. */
  reading?: boolean;
  /** The person or the agent named it, so the page's own title doesn't replace it. */
  titled?: boolean;
  /** Why the agent chose it, for a source found on the web. */
  why?: string;
  createdAt: string;
}

export interface NotebookNote {
  id: string;
  title: string;
  /** Markdown. */
  body: string;
  /** Who wrote it: the person, or an agent run (a transformation, a saved answer). */
  origin: "person" | "agent";
  /** The transformation that wrote it, and the source it ran on. */
  transformation?: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved prompt run on one source, whose answer becomes a note. */
export interface Transformation {
  id: string;
  title: string;
  prompt: string;
}

/** How a notebook's chat answers, which the person sets in Customize. */
export interface NotebookChatStyle {
  /** "guide" teaches step by step and checks understanding; "custom" follows `custom`. */
  goal: "default" | "guide" | "custom";
  /** The person's own instructions for the "custom" goal. */
  custom?: string;
  length: "default" | "shorter" | "longer";
}

export interface Notebook {
  id: string;
  title: string;
  sources: NotebookSource[];
  notes: NotebookNote[];
  /** The person's own transformations; the built-in ones are in code. */
  transformations: Transformation[];
  /** The chats asked from this notebook, newest first. */
  chats: string[];
  /** The conversation open in the notebook now, with the questions as the person asked them
   * (the turns themselves carry the sources too). */
  thread?: { conversationId: string; questions: string[] };
  /** The Space note it was last shared as. */
  sharedNote?: { spaceId: string; noteId: string };
  /** One emoji for the notebook's cover, the agent's pick until the person chooses one. */
  emoji?: string;
  /** How its chat answers; unset answers in the default way. */
  chatStyle?: NotebookChatStyle;
  /** What the agent wrote about the sources: a summary, its topics and questions to start from.
   * `sources` names the sources it was written from, so a change asks for a new one. */
  brief?: {
    summary: string;
    topics: string[];
    questions: string[];
    sources: string;
  };
  createdAt: string;
  updatedAt: string;
}

/** Spaced review's state for one card (SM-2). */
export interface CardReview {
  /** When the card is next due, ISO. */
  due: string;
  /** Days until the next review after a pass. */
  interval: number;
  ease: number;
  /** Passes in a row. */
  reps: number;
  lapses: number;
  reviewedAt?: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  review: CardReview;
}

export interface Deck {
  id: string;
  title: string;
  cards: Flashcard[];
  notebookId?: string;
  /** The chat whose agent made it. */
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  question: string;
  choices: string[];
  /** Index into choices. */
  answer: number;
  explanation?: string;
}

/** One line of an audio overview: speaker 0 or 1, and what they say. */
export interface OverviewLine {
  speaker: 0 | 1;
  text: string;
}

/** A guide, a quiz or an audio overview: something an agent made to learn from. */
/** A node of a mind map: a label and the ideas under it. */
export interface MindNode {
  label: string;
  children?: MindNode[];
}

/** One scene of a video overview: what it shows, and what is said over it. */
export interface VideoScene {
  /** The engine's illustration for the scene, an SVG drawn at 1280 by 720. */
  svg?: string;
  heading: string;
  points?: string[];
  narration: string;
  /** What the video model films for the scene: a silent clip behind the narration. */
  shot?: string;
  /** The scene's clip is filmed and kept on this computer. */
  clip?: boolean;
  /** How long its narration runs, once spoken. */
  seconds?: number;
}

export interface Guide {
  id: string;
  /** guide: a report in Markdown (its `report` says which); slides: Markdown slides split by ---. */
  kind: "guide" | "quiz" | "overview" | "mindmap" | "slides" | "infographic" | "video";
  /** Which report a guide is: study guide, briefing doc, FAQ, timeline, data table. */
  report?: string;
  /** A mind map's tree. */
  map?: MindNode;
  /** A video overview's scenes. An infographic's SVG is its body. */
  scenes?: VideoScene[];
  title: string;
  /** Markdown, for a guide. */
  body: string;
  questions?: QuizQuestion[];
  /** The person's last score on a quiz, out of its questions. */
  lastScore?: number;
  /** An audio overview's script, and its audio, spoken on this computer's speech key. */
  script?: OverviewLine[];
  audio?: { state: "making" | "ready" | "failed"; seconds?: number; error?: string };
  /** A video overview's clips, filmed on this computer's video model; "off" without one. */
  clips?: { state: "making" | "ready" | "failed" | "off"; error?: string };
  /** The Space note it was last shared as. */
  sharedNote?: { spaceId: string; noteId: string };
  notebookId?: string;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

/** What a Tutor run makes when its reply arrives. */
export type TutorJobKind =
  | "guide"
  | "deck"
  | "quiz"
  | "overview"
  | "mindmap"
  | "slides"
  | "infographic"
  | "video"
  | "research"
  | "brief"
  | "note"
  | "summary";

/**
 * A run on the person's own agent that makes something for Tutor. It runs as an ordinary chat,
 * kept out of the sidebar, and its reply is read into a guide, deck, quiz or note when it finishes.
 */
export interface TutorJob {
  id: string;
  kind: TutorJobKind;
  title: string;
  agentId: string;
  conversationId: string;
  prompt: string;
  notebookId?: string;
  /** The source a summary or transformation ran on. */
  sourceId?: string;
  transformation?: string;
  /** The report a guide run writes. */
  report?: string;
  /** Waiting for another turn to end before it starts. */
  state: "queued" | "running" | "done" | "failed";
  error?: string;
  /** Times it started again by itself after Misty closed under it. */
  restarts?: number;
  /** What it made. */
  resultId?: string;
  createdAt: string;
  updatedAt: string;
}
