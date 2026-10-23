use std::{
    collections::BTreeMap,
    env, fs,
    net::Ipv4Addr,
    path::Path,
    thread,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
    SigningKey, VerifyingKey,
};
use rand::{rngs::OsRng, RngCore};
use serde_json::json;
use url::Url;

use crate::{
    artifacts::write_private,
    environment::{self, Target},
    process::CommandSpec,
    workspace::Workspace,
};

mod dev;
pub use dev::*;
mod env_files;
use env_files::*;
mod health;
pub use health::*;
mod prod;
pub use prod::*;
mod staging;
pub use staging::*;
mod tunnel;
pub use tunnel::*;
mod worker;
pub use worker::*;
mod secrets;
use secrets::*;
mod r2;
pub use r2::*;
mod release;
pub use release::release;
#[cfg(test)]
mod tests;

const TICKET_PRIVATE_KEY: &str = "JOURNAL_COLLAB_TICKET_PRIVATE_KEY";
const TICKET_PUBLIC_KEY: &str = "JOURNAL_COLLAB_TICKET_PUBLIC_KEY";
const CONTROL_SECRET: &str = "JOURNAL_COLLAB_CONTROL_SECRET";
const PROJECTION_SECRET: &str = "JOURNAL_COLLAB_PROJECTION_SECRET";
const ROOM_SALT: &str = "JOURNAL_COLLAB_ROOM_SALT";
const DEVICE_TICKET_PRIVATE_KEY: &str = "MISTY_DEVICE_TICKET_PRIVATE_KEY";
const DEVICE_PAIRING_PEPPER: &str = "MISTY_DEVICE_PAIRING_PEPPER";

pub(crate) fn development_compose() -> CommandSpec {
    compose("compose.dev.yml")
}

fn compose(file: &str) -> CommandSpec {
    // load_command_environment already applied the configured files with shell
    // overrides preserved. Do not require placeholders or let Compose load an
    // unrelated default .env file (our .env path is a directory).
    CommandSpec::new("docker")
        .env("COMPOSE_DISABLE_ENV_FILE", "1")
        .env_remove("COMPOSE_ENV_FILES")
        .args(["compose", "--file", file])
}
