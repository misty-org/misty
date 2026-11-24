use std::path::PathBuf;

use serde::Serialize;

use database::store::Store;

pub mod agy;
pub mod claude;
pub mod codex;
#[cfg(all(test, unix))]
mod every_engine;
#[cfg(all(test, unix))]
mod live_turn;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Runs {
    Turn,
    Misty,
}

#[derive(Clone, Copy, Debug)]
pub struct Command {
    pub name: &'static str,
    pub description: &'static str,
    pub argument_hint: Option<&'static str>,
    pub runs: Runs,
}

pub const fn turn(name: &'static str, description: &'static str) -> Command {
    Command {
        name,
        description,
        argument_hint: None,
        runs: Runs::Turn,
    }
}

pub const fn misty(name: &'static str, description: &'static str) -> Command {
    Command {
        name,
        description,
        argument_hint: None,
        runs: Runs::Misty,
    }
}

impl Command {
    pub const fn hint(mut self, hint: &'static str) -> Self {
        self.argument_hint = Some(hint);
        self
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Output {
    Info {
        title: String,
        sections: Vec<Section>,
    },
    Send {
        text: String,
    },
    Done {
        notice: Option<String>,
    },
    Open {
        target: String,
    },
    Fork {
        session: String,
        title: Option<String>,
        prompt: Option<String>,
    },
    Rename {
        title: String,
    },
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<Row>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Row {
    pub label: String,
    pub value: String,
}

pub fn row(label: impl Into<String>, value: impl Into<String>) -> Row {
    Row {
        label: label.into(),
        value: value.into(),
    }
}

impl Output {
    pub fn info(title: impl Into<String>, sections: Vec<Section>) -> Self {
        Self::Info {
            title: title.into(),
            sections,
        }
    }
    pub fn done(notice: impl Into<String>) -> Self {
        Self::Done {
            notice: Some(notice.into()),
        }
    }
    pub fn open(target: impl Into<String>) -> Self {
        Self::Open {
            target: target.into(),
        }
    }
    pub fn send(text: impl Into<String>) -> Self {
        Self::Send { text: text.into() }
    }
}

pub struct Context {
    pub engine: String,
    pub account: String,
    pub conversation: String,
    pub folder: Option<PathBuf>,
    pub session: Option<String>,
    pub args: String,
    pub db: Store,
}

pub fn commands(engine: &str) -> &'static [Command] {
    match engine {
        "claude" => claude::COMMANDS,
        "codex" => codex::COMMANDS,
        "agy" => agy::COMMANDS,
        _ => &[],
    }
}

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    let known = commands(&context.engine)
        .iter()
        .any(|command| command.name == name && command.runs == Runs::Misty);
    if !known {
        return Err(format!("Misty doesn't run /{name} for this engine."));
    }
    match context.engine.as_str() {
        "claude" => claude::run(context, name).await,
        "codex" => codex::run(context, name).await,
        "agy" => agy::run(context, name).await,
        _ => Err(format!("Misty doesn't run /{name} for this engine.")),
    }
}
