type LessonObjectiveStatus = "pending" | "in_progress" | "done" | "skipped";

export interface LessonObjective {
  id: string;
  title: string;
  contract?: string;
  status: LessonObjectiveStatus;
}

type LessonStatus = "active" | "paused" | "finished";

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
  summary?: string;
  previousId?: string;
  appliedRuns: string[];
  courseId?: string;
  createdAt: string;
  updatedAt: string;
}

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

export type LessonRoute =
  { kind: "continue" } | { kind: "resume"; id: string } | { kind: "new"; title: string };

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

export interface LessonSummaryPayload {
  id: string;
  title: string;
  goal?: string;
  progress?: string;
}

export interface Course {
  id: string;
  agentId?: string;
  title: string;
  lessons: { title: string; goal?: string; lessonId?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface CoursePlan {
  title?: string;
  lessons?: { title?: string; goal?: string }[];
}

export interface CoursePayload {
  title: string;
  lessons: { title: string; goal?: string; status: "done" | "current" | "next" }[];
}
