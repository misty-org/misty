//! The shell: `sh -c "..."`, `sh script.sh`, or commands read from standard input. It's brush, a shell
//! written in Rust that follows bash, so scripts behave the same on every computer.
use std::ffi::OsString;

use brush_builtins::{BuiltinSet, ShellBuilderExt};
use brush_core::{ProfileLoadBehavior, RcLoadBehavior, Shell};

/// What a person who ran the program with the wrong arguments gets, by the shell's convention.
const USAGE_ERROR: i32 = 2;

enum Asked {
    Command { command: String, arguments: Vec<String> },
    Script { path: String, arguments: Vec<String> },
    Stdin,
}

fn text(arg: &OsString) -> Result<String, String> {
    arg.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "an argument isn't valid text".to_owned())
}

fn parse(args: &[OsString]) -> Result<Asked, String> {
    let rest = args.get(1..).unwrap_or_default();
    match rest.first().map(|arg| arg.to_string_lossy()) {
        None => Ok(Asked::Stdin),
        Some(first) if first == "-c" => {
            let command = rest.get(1).ok_or("-c needs a command")?;
            Ok(Asked::Command {
                command: text(command)?,
                arguments: rest.iter().skip(2).map(text).collect::<Result<_, _>>()?,
            })
        }
        Some(first) if first.starts_with('-') && first != "-" => {
            Err(format!("{first}: not an option here"))
        }
        Some(_) => Ok(Asked::Script {
            path: text(&rest[0])?,
            arguments: rest.iter().skip(1).map(text).collect::<Result<_, _>>()?,
        }),
    }
}

async fn run_asked(asked: Asked) -> Result<i32, brush_core::Error> {
    let builder = Shell::builder()
        .default_builtins(BuiltinSet::BashMode)
        .profile(ProfileLoadBehavior::Skip)
        .rc(RcLoadBehavior::Skip)
        .shell_name("sh".to_owned());
    let result = match asked {
        Asked::Command { command, arguments } => {
            let mut shell = builder
                .command_string_mode(true)
                .shell_args(arguments)
                .build()
                .await?;
            shell.run_dash_c_command(command).await?
        }
        Asked::Script { path, arguments } => {
            let mut shell = builder.build().await?;
            shell.run_script(path, arguments.iter()).await?
        }
        Asked::Stdin => {
            let mut source = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut source)?;
            let mut shell = builder.command_string_mode(true).build().await?;
            shell.run_dash_c_command(source).await?
        }
    };
    Ok(i32::from(u8::from(result.exit_code)))
}

pub fn run(args: &[OsString]) -> i32 {
    let asked = match parse(args) {
        Ok(asked) => asked,
        Err(message) => {
            eprintln!("sh: {message}");
            return USAGE_ERROR;
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("sh: {error}");
            return 1;
        }
    };
    match runtime.block_on(run_asked(asked)) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("sh: {error}");
            1
        }
    }
}
