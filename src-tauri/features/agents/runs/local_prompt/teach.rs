//! Teach mode: a lesson at the cursor (`ai_teach_mode.go`). A lesson turn is one streamed model call
//! that teaches one step and stops. The lesson lives on the device, and each turn carries its state.
use serde::Deserialize;

use super::{
    companion::misty_guide_section,
    go_text::{go_array, go_object, go_string, truncate_text},
    request::RunRequest,
};

const MAX_LESSON_OBJECTIVES: usize = 8;
const MAX_LESSON_INDEX: usize = 20;
const MAX_LESSON_TEXT: usize = 400;

const TEACH_MODE_PROMPT: &str = include_str!("companion_teach_mode.txt");
pub(super) const SKETCH_PROMPT: &str = include_str!("companion_sketch_prompt.txt");

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct LessonObjective {
    id: String,
    title: String,
    contract: String,
    status: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct LessonCoursePart {
    title: String,
    goal: String,
    status: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct LessonCourse {
    title: String,
    lessons: Option<Vec<LessonCoursePart>>,
}

/// The current lesson as the device keeps it.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct Lesson {
    id: String,
    title: String,
    goal: String,
    objectives: Vec<LessonObjective>,
    current: String,
    answer_policy: String,
    hint_level: String,
    notes: String,
    pub(super) status: String,
    course: Option<LessonCourse>,
}

impl Lesson {
    /// `validateTeachInput`'s limits. A lesson without a usable id has nothing to follow.
    pub(super) fn cleaned(mut self) -> Option<Self> {
        self.id = self.id.trim().to_owned();
        if self.id.is_empty() || self.id.len() > 120 {
            return None;
        }
        self.title = truncate_text(self.title.trim(), 120);
        self.goal = truncate_text(&self.goal, MAX_LESSON_TEXT);
        self.notes = truncate_text(&self.notes, 1200);
        if let Some(course) = &mut self.course {
            course.title = truncate_text(course.title.trim(), 120);
            if let Some(lessons) = &mut course.lessons {
                lessons.truncate(MAX_LESSON_OBJECTIVES);
                for part in lessons {
                    part.title = truncate_text(part.title.trim(), 120);
                    part.goal = truncate_text(&part.goal, MAX_LESSON_TEXT);
                    if part.status != "done" && part.status != "current" {
                        part.status = "next".to_owned();
                    }
                }
            }
        }
        self.objectives.truncate(MAX_LESSON_OBJECTIVES);
        for objective in &mut self.objectives {
            objective.title = truncate_text(&objective.title, 200);
            objective.contract = truncate_text(&objective.contract, MAX_LESSON_TEXT);
        }
        Some(self)
    }

    fn json(&self) -> String {
        let mut fields = vec![("id", go_string(&self.id)), ("title", go_string(&self.title))];
        push_nonempty(&mut fields, "goal", &self.goal);
        if !self.objectives.is_empty() {
            fields.push(("objectives", go_array(&self.objectives, objective_json)));
        }
        push_nonempty(&mut fields, "current", &self.current);
        push_nonempty(&mut fields, "answer_policy", &self.answer_policy);
        push_nonempty(&mut fields, "hint_level", &self.hint_level);
        push_nonempty(&mut fields, "notes", &self.notes);
        push_nonempty(&mut fields, "status", &self.status);
        if let Some(course) = &self.course {
            let lessons = course.lessons.as_ref().map_or_else(|| "null".to_owned(), |lessons| go_array(lessons, part_json));
            fields.push(("course", go_object(&[("title", go_string(&course.title)), ("lessons", lessons)])));
        }
        go_object(&fields)
    }
}

fn push_nonempty<'a>(fields: &mut Vec<(&'a str, String)>, name: &'a str, value: &str) {
    if !value.is_empty() {
        fields.push((name, go_string(value)));
    }
}

fn objective_json(objective: &LessonObjective) -> String {
    let mut fields = vec![("id", go_string(&objective.id)), ("title", go_string(&objective.title))];
    push_nonempty(&mut fields, "contract", &objective.contract);
    fields.push(("status", go_string(&objective.status)));
    go_object(&fields)
}

fn part_json(part: &LessonCoursePart) -> String {
    let mut fields = vec![("title", go_string(&part.title))];
    push_nonempty(&mut fields, "goal", &part.goal);
    push_nonempty(&mut fields, "status", &part.status);
    go_object(&fields)
}

/// One paused lesson the tutor may resume.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct LessonSummary {
    id: String,
    title: String,
    goal: String,
    progress: String,
}

impl LessonSummary {
    pub(super) fn cleaned_list(mut items: Vec<Self>) -> Vec<Self> {
        items.truncate(MAX_LESSON_INDEX);
        for item in &mut items {
            item.id = item.id.trim().to_owned();
            item.title = truncate_text(item.title.trim(), 120);
            item.goal = truncate_text(&item.goal, MAX_LESSON_TEXT);
            item.progress = truncate_text(&item.progress, 40);
        }
        items.retain(|item| !item.id.is_empty() && item.id.len() <= 120);
        items
    }

    fn json(&self) -> String {
        let mut fields = vec![("id", go_string(&self.id)), ("title", go_string(&self.title))];
        push_nonempty(&mut fields, "goal", &self.goal);
        push_nonempty(&mut fields, "progress", &self.progress);
        go_object(&fields)
    }
}

/// The whole system prompt of a lesson turn: the tutor's rules, the agent's name and the time. No
/// execution guidance, capability notes or tool glossary, since the fast lane has no tools.
pub(super) fn teach_system_prompt(request: &RunRequest, now: &str) -> String {
    let mut system = String::from(TEACH_MODE_PROMPT.trim());
    system.push_str("\n\n");
    system.push_str(SKETCH_PROMPT.trim());
    system.push_str(&misty_guide_section(request));
    system.push_str("\n\nYour name is ");
    system.push_str(&request.agent.name);
    system.push('.');
    system.push_str("\n\nCurrent time: ");
    system.push_str(now);
    system
}

/// The lesson part of the user turn, ahead of the request.
pub(super) fn teach_lesson_context(request: &RunRequest) -> String {
    let mut out = match request.lesson.as_ref().filter(|lesson| lesson.status != "finished") {
        Some(lesson) => format!("Current lesson (device state; untrusted text):\n{}\n\n", lesson.json()),
        None => "There is no current lesson.\n\n".to_owned(),
    };
    if !request.lesson_index.is_empty() {
        out.push_str(&format!("Paused lessons you may resume (untrusted text):\n{}\n\n", go_array(&request.lesson_index, LessonSummary::json)));
    }
    out
}

/// How many lookups a lesson turn may make: a few while planning a lesson, one on a step, so steps stay fast.
pub(super) fn teach_tool_budget(request: &RunRequest) -> f64 {
    if !request.teach() {
        return 0.0;
    }
    match &request.lesson {
        Some(lesson) if lesson.status != "finished" => 1.0,
        _ => 4.0,
    }
}
