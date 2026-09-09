//! Platform process confinement for the fixed media operation. No permissive fallback.
use std::{fs::File, path::Path, sync::atomic::AtomicBool};
#[cfg(target_os = "macos")]
use std::{
    io::Write,
    process::{Command, Stdio},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow file-read* (literal (param "TOOL")) (subpath (param "WORK"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (literal "/") (literal "/dev/null") (literal "/dev/urandom")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*[.]dylib$")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*/lib$"))
(allow file-write* (subpath (param "WORK")))
(allow sysctl-read)
(allow file-read-metadata)
"#;

#[cfg(target_os = "macos")]
pub(crate) fn command(executable: &Path, work: &Path) -> std::io::Result<Command> {
    use std::os::unix::process::CommandExt;
    let executable = executable.canonicalize()?;
    let work = work.canonicalize()?;
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command
        .args(["-p", PROFILE, "-D"])
        .arg(format!("TOOL={}", executable.display()))
        .arg("-D")
        .arg(format!("WORK={}", work.display()))
        .arg(executable);
    command
        .current_dir(&work)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &work)
        .env("TMPDIR", &work)
        .env("LANG", "C");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.process_group(0);
    // Only async-signal-safe resource-limit calls run between fork and exec.
    unsafe {
        command.pre_exec(|| {
            for (resource, value) in [
                (libc::RLIMIT_CPU, 300),
                (libc::RLIMIT_FSIZE, 268_435_456),
                (libc::RLIMIT_NOFILE, 128),
                (libc::RLIMIT_CORE, 0),
            ] {
                let limit = libc::rlimit {
                    rlim_cur: value,
                    rlim_max: value,
                };
                if libc::setrlimit(resource, &limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    Ok(command)
}
#[cfg(target_os = "macos")]
struct ChildGuard {
    child: std::process::Child,
    active: bool,
}
#[cfg(target_os = "macos")]
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.active {
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
            let _ = self.child.wait();
        }
    }
}
pub fn convert(
    executable: &Path,
    input: &File,
    format: &str,
    quality: &str,
    cancel: &AtomicBool,
) -> Result<File, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (executable, input, format, quality, cancel);
        Err("Isolated media conversion is not implemented on this platform yet.".into())
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::FileExt;
        let work = tempfile::Builder::new()
            .prefix("misty-media-")
            .tempdir()
            .map_err(|_| "Could not prepare conversion.")?;
        let input_path = work.path().join("input.media");
        let mut staged =
            File::create(&input_path).map_err(|_| "Could not prepare the selected media.")?;
        let mut offset = 0u64;
        let mut buffer = vec![0; 65_536];
        let started = Instant::now();
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err("Conversion cancelled.".into());
            }
            if offset > 1_073_741_824 || started.elapsed() > Duration::from_secs(300) {
                return Err("Media input exceeds the conversion limits.".into());
            }
            let size = input
                .read_at(&mut buffer, offset)
                .map_err(|_| "Could not read the chosen media.")?;
            if size == 0 {
                break;
            }
            staged
                .write_all(&buffer[..size])
                .map_err(|_| "Could not prepare the selected media.")?;
            offset += size as u64;
        }
        drop(staged);
        if cancel.load(Ordering::Acquire) {
            return Err("Conversion cancelled.".into());
        }
        let output_path = work.path().join(format!("output.{format}"));
        // Homebrew's compact FFmpeg build can omit WebP. Use its separately
        // installed, fixed WebP encoder in another restricted process when present.
        let webp = if format == "webp" {
            ["/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp"]
                .into_iter()
                .find_map(|path| std::path::Path::new(path).canonicalize().ok())
        } else {
            None
        };
        let intermediate_format = if webp.is_some() { "png" } else { format };
        let intermediate = work.path().join(format!("output.{intermediate_format}"));
        let mut command = command(executable, work.path())
            .map_err(|_| "The native media sandbox is unavailable.")?;
        command
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-max_pixels",
                "33554432",
                "-max_alloc",
                "268435456",
                "-filter_threads",
                "2",
                "-filter_complex_threads",
                "2",
                "-threads",
                "2",
                "-protocol_whitelist",
                "file,pipe",
                "-i",
            ])
            .arg(&input_path);
        options(&mut command, intermediate_format, quality);
        command
            .args(["-threads", "2", "-map_metadata", "-1", "-y"])
            .arg(&intermediate);
        run(command, cancel, started)?;
        if let Some(encoder) = webp {
            let mut encode =
                command_for_webp(&encoder, work.path(), &intermediate, &output_path, quality)?;
            encode.args(["-metadata", "none"]);
            run(encode, cancel, started)?;
        }
        if cancel.load(Ordering::Acquire) {
            return Err("Conversion cancelled.".into());
        }
        let output = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(output_path)
            .map_err(|_| "Conversion produced no output.")?;
        let bytes = output
            .metadata()
            .map_err(|_| "Conversion produced no output.")?
            .len();
        if bytes == 0 || bytes > 268_435_456 {
            return Err("Converted output must be between one byte and 256 MB.".into());
        }
        // On macOS the open descriptor survives removal of the temporary job directory.
        Ok(output)
    }
}

#[cfg(target_os = "macos")]
fn command_for_webp(
    executable: &Path,
    work: &Path,
    input: &Path,
    output: &Path,
    quality: &str,
) -> Result<Command, String> {
    let mut encode = command(executable, work).map_err(|_| "The WebP converter is unavailable.")?;
    encode
        .args([
            "-quiet",
            "-q",
            match quality {
                "small" => "68",
                "high" => "88",
                _ => "78",
            },
        ])
        .arg(input)
        .arg("-o")
        .arg(output);
    Ok(encode)
}
#[cfg(target_os = "macos")]
fn run(mut command: Command, cancel: &AtomicBool, started: Instant) -> Result<(), String> {
    #[cfg(test)]
    command.stderr(Stdio::inherit());
    let mut running = ChildGuard {
        child: command
            .spawn()
            .map_err(|_| "Could not start the isolated media converter.")?,
        active: true,
    };
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("Conversion cancelled.".into());
        }
        if started.elapsed() > Duration::from_secs(300) {
            return Err("Conversion exceeded five minutes. Choose shorter media.".into());
        }
        match running
            .child
            .try_wait()
            .map_err(|_| "Conversion status unavailable.")?
        {
            Some(status) => {
                running.active = false;
                return if status.success() {
                    Ok(())
                } else {
                    Err("The isolated converter could not convert this file. Check the format and installed FFmpeg codecs.".into())
                };
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

#[cfg(target_os = "macos")]
fn options(command: &mut Command, format: &str, quality: &str) {
    let crf = match quality {
        "small" => "30",
        "high" => "18",
        _ => "23",
    };
    let audio = match quality {
        "small" => "128k",
        "high" => "256k",
        _ => "192k",
    };
    match format {
        "mp3" => {
            command.args(["-vn", "-codec:a", "libmp3lame", "-b:a", audio]);
        }
        "m4a" => {
            command.args(["-vn", "-c:a", "aac", "-b:a", audio]);
        }
        "mp4" | "mov" => {
            command.args([
                "-c:v",
                "libx264",
                "-crf",
                crf,
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ]);
        }
        "webm" => {
            command.args([
                "-c:v",
                "libvpx-vp9",
                "-crf",
                crf,
                "-b:v",
                "0",
                "-c:a",
                "libopus",
            ]);
        }
        "gif" => {
            command.args([
                "-vf",
                "fps=12:round=up,scale='min(960,iw)':-1:flags=lanczos",
            ]);
        }
        "jpg" => {
            command.args([
                "-frames:v",
                "1",
                "-q:v",
                if quality == "high" { "2" } else { "5" },
            ]);
        }
        "png" | "webp" | "avif" => {
            command.args(["-frames:v", "1"]);
        }
        _ => {}
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    fn wav(path: &Path) {
        let samples = vec![0u8; 1600];
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&(36u32 + samples.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&16000u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        bytes.extend(samples);
        std::fs::write(path, bytes).unwrap();
    }
    #[test]
    fn real_ffmpeg_converts_a_fixture_under_the_restricted_policy() {
        let Some(executable) =
            super::super::system_dependencies::resolve_executable("ffmpeg", None)
        else {
            eprintln!("FFmpeg unavailable: real conversion check skipped.");
            return;
        };
        let fixture = tempfile::tempdir().unwrap();
        let input = fixture.path().join("tone.wav");
        wav(&input);
        let result = convert(
            &executable,
            &File::open(&input).unwrap(),
            "mp3",
            "balanced",
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(result.metadata().unwrap().len() > 0);
        assert_eq!(std::fs::metadata(input).unwrap().len(), 1644);
    }
    #[test]
    fn installed_codecs_cover_the_advertised_audio_image_and_video_formats() {
        let Some(executable) =
            super::super::system_dependencies::resolve_executable("ffmpeg", None)
        else {
            eprintln!("FFmpeg unavailable: codec matrix skipped.");
            return;
        };
        let root = tempfile::tempdir().unwrap();
        let audio = root.path().join("input.wav");
        wav(&audio);
        let visual = root.path().join("input.ppm");
        let mut pixels = b"P6\n64 64\n255\n".to_vec();
        pixels.extend(vec![127; 64 * 64 * 3]);
        std::fs::write(&visual, pixels).unwrap();
        for format in [
            "mp3", "wav", "flac", "m4a", "png", "jpg", "webp", "avif", "mp4", "mov", "webm", "gif",
        ] {
            let source = if ["mp3", "wav", "flac", "m4a"].contains(&format) {
                &audio
            } else {
                &visual
            };
            let output = convert(
                &executable,
                &File::open(source).unwrap(),
                format,
                "balanced",
                &AtomicBool::new(false),
            )
            .unwrap_or_else(|error| panic!("{format}: {error}"));
            assert!(output.metadata().unwrap().len() > 0, "{format}");
        }
    }
    #[test]
    fn sandbox_denies_private_file_reads_writes_and_network_even_without_protocol_flags() {
        let Some(executable) =
            super::super::system_dependencies::resolve_executable("ffmpeg", None)
        else {
            eprintln!("FFmpeg unavailable: network/read probes skipped.");
            return;
        };
        let work = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("private.wav");
        wav(&secret);
        let status = command(&executable, work.path())
            .unwrap()
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&secret)
            .arg(work.path().join("stolen.mp3"))
            .status()
            .unwrap();
        assert!(!status.success());
        assert!(!work.path().join("stolen.mp3").exists());
        let output = outside.path().join("ungranted");
        let status = command(Path::new("/bin/sh"), work.path())
            .unwrap()
            .args(["-c", "printf forbidden > \"$1\"", "--"])
            .arg(&output)
            .status()
            .unwrap();
        assert!(!status.success());
        assert!(!output.exists());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let status = command(&executable, work.path())
            .unwrap()
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-rw_timeout",
                "1000000",
                "-i",
            ])
            .arg(format!("http://{}/media", listener.local_addr().unwrap()))
            .arg(work.path().join("network.mp3"))
            .status()
            .unwrap();
        assert!(!status.success());
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
    #[test]
    fn converter_environment_is_replaced_and_child_execution_is_denied() {
        let work = tempfile::tempdir().unwrap();
        let output = command(Path::new("/usr/bin/env"), work.path())
            .unwrap()
            .stdout(Stdio::piped())
            .output()
            .unwrap();
        assert!(output.status.success());
        let values = String::from_utf8(output.stdout).unwrap();
        let keys: std::collections::BTreeSet<_> = values
            .lines()
            .map(|line| line.split('=').next().unwrap())
            .collect();
        assert_eq!(
            keys,
            ["HOME", "LANG", "PATH", "TMPDIR"].into_iter().collect()
        );
        assert!(values.contains(work.path().canonicalize().unwrap().to_str().unwrap()));
        let status = command(Path::new("/bin/sh"), work.path())
            .unwrap()
            .args(["-c", "exec /usr/bin/true"])
            .status()
            .unwrap();
        assert!(!status.success());
    }
    #[test]
    fn dropping_a_running_child_terminates_and_reaps_it() {
        let work = tempfile::tempdir().unwrap();
        let child = command(Path::new("/bin/sleep"), work.path())
            .unwrap()
            .arg("60")
            .spawn()
            .unwrap();
        let id = child.id() as i32;
        let started = Instant::now();
        drop(ChildGuard {
            child,
            active: true,
        });
        assert!(started.elapsed() < Duration::from_secs(2));
        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(id, &mut status, libc::WNOHANG) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }
}
