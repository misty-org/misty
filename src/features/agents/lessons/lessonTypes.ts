/**
 * Teach mode's lessons (docs/design/agents-at-cursor/BRIEF.md, revision 4). A lesson is
 * one Teach-mode conversation's progress, kept on this device beside its chat. Its id
 * is the conversation's id.
 */
export type LessonObjectiveStatus = "pending" | "in_progress" | "done" | "skipped";

export interface LessonObjective {
  id: string;
  title: string;
  /** What to look at and what done looks like; checks compare only this. */
  contract?: string;
  status: LessonObjectiveStatus;
}

export type LessonStatus = "active" | "paused" | "finished";

export interface Lesson {
  id: string;
  agentId?: string;
  title: string;
  goal?: string;
  objectives: LessonObjective[];
  current?: string;
  answerPolicy: "hints" | "code";
  hintLevel: "nudge" | "hint" | "line";
  notes?: string;
  status: LessonStatus;
  /** What was achieved, written when the lesson finishes. */
  summary?: string;
  /** The lesson this one paused when it started or resumed, for "no, keep going". */
  previousId?: string;
  /** Runs whose replies were already applied, newest last. */
  appliedRuns: string[];
  /** The course this lesson is part of, for a broad topic taught in parts. */
  courseId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields a reply's [LESSON:{...}] tag may change. */
export interface LessonPatch {
  title?: string;
  goal?: string;
  objectives?: LessonObjective[];
  current?: string;
  answer_policy?: "hints" | "code";
  hint_level?: "nudge" | "hint" | "line";
  notes?: string;
  status?: "active" | "finished";
  summary?: string;
}

/** Which lesson a reply belongs to: [ROUTE:continue|resume:<id>|new:<title>]. */
export type LessonRoute =
  { kind: "continue" } | { kind: "resume"; id: string } | { kind: "new"; title: string };

/** The current lesson as a turn sends it (ai_teach_mode.go aiLessonState). */
export interface LessonPayload {
  id: string;
  title: string;
  goal?: string;
  objectives?: LessonObjective[];
  current?: string;
  answer_policy?: "hints" | "code";
  hint_level?: "nudge" | "hint" | "line";
  notes?: string;
  status?: LessonStatus;
  course?: CoursePayload;
}

/** A paused lesson the tutor may resume (ai_teach_mode.go aiLessonSummary). */
export interface LessonSummaryPayload {
  id: string;
  title: string;
  goal?: string;
  progress?: string;
}

/** A broad topic taught as a few lessons: [COURSE:{"title","lessons":[{"title","goal"}]}]. */
export interface Course {
  id: string;
  agentId?: string;
  title: string;
  /** In order; a planned lesson gets its chat when it starts. */
  lessons: { title: string; goal?: string; lessonId?: string }[];
  createdAt: string;
  updatedAt: string;
}

/** What a reply's [COURSE:{...}] tag carries. */
export interface CoursePlan {
  title?: string;
  lessons?: { title?: string; goal?: string }[];
}

/** A course's outline as a lesson turn sends it, with where this lesson sits. */
export interface CoursePayload {
  title: string;
  lessons: { title: string; goal?: string; status: "done" | "current" | "next" }[];
}
