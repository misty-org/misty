//! The fixed media conversion: FFmpeg, run in the tool sandbox, on a private
//! copy of the chosen media.
use std::{
    ffi::OsString,
    fs::File,
    io::Write,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

use super::super::tool_sandbox::{read_at, Sandbox, Stopped, TIME_LIMIT};

const MAX_INPUT: u64 = 1_073_741_824;
const MAX_OUTPUT: u64 = 268_435_456;

impl Stopped {
    /// The message for a media conversion.
    fn conversion(self) -> String {
        match self {
            Self::Cancelled => "Conversion cancelled.".into(),
            Self::TimedOut => "Conversion exceeded five minutes. Choose shorter media.".into(),
            Self::Failed(message) => message,
        }
    }
}

/// Copies the chosen media into the sandbox, so the tool never sees the
/// person's own file.
fn stage(input: &File, path: &Path, cancel: &AtomicBool, started: Instant) -> Result<(), String> {
    let mut staged = File::create(path).map_err(|_| "Could not prepare the selected media.")?;
    let mut offset = 0u64;
    let mut buffer = vec![0; 65_536];
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("Conversion cancelled.".into());
        }
        if offset > MAX_INPUT || started.elapsed() > TIME_LIMIT {
            return Err("Media input exceeds the conversion limits.".into());
        }
        let size =
            read_at(input, &mut buffer, offset).map_err(|_| "Could not read the chosen media.")?;
        if size == 0 {
            return Ok(());
        }
        staged
            .write_all(&buffer[..size])
            .map_err(|_| "Could not prepare the selected media.")?;
        offset += size as u64;
    }
}

pub fn convert(
    executable: &Path,
    input: &File,
    format: &str,
    quality: &str,
    cancel: &AtomicBool,
) -> Result<File, String> {
    let sandbox = Sandbox::new()?;
    let started = Instant::now();
    let input_path = sandbox.path().join("input.media");
    stage(input, &input_path, cancel, started)?;
    if cancel.load(Ordering::Acquire) {
        return Err("Conversion cancelled.".into());
    }
    let output_path = sandbox.path().join(format!("output.{format}"));
    // Homebrew's compact FFmpeg build can omit WebP. Use its separately
    // installed, fixed WebP encoder in another restricted process when present.
    let webp = if format == "webp" {
        webp_encoder()
    } else {
        None
    };
    let intermediate_format = if webp.is_some() { "png" } else { format };
    let intermediate = sandbox.path().join(format!("output.{intermediate_format}"));
    let mut arguments: Vec<OsString> = [
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
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    arguments.push(input_path.into_os_string());
    arguments.extend(
        options(intermediate_format, quality)
            .into_iter()
            .map(OsString::from),
    );
    arguments.extend(["-threads", "2", "-map_metadata", "-1", "-y"].map(OsString::from));
    arguments.push(intermediate.clone().into_os_string());
    if !sandbox
        .run(executable, &arguments, None, cancel, started)
        .map_err(Stopped::conversion)?
    {
        return Err("The isolated converter could not convert this file. Check the format and installed FFmpeg codecs.".into());
    }
    if let Some(encoder) = webp {
        let quality = match quality {
            "small" => "68",
            "high" => "88",
            _ => "78",
        };
        let mut arguments: Vec<OsString> = ["-quiet", "-q", quality]
            .into_iter()
            .map(OsString::from)
            .collect();
        arguments.push(intermediate.into_os_string());
        arguments.push("-o".into());
        arguments.push(output_path.clone().into_os_string());
        arguments.extend(["-metadata", "none"].map(OsString::from));
        if !sandbox
            .run(&encoder, &arguments, None, cancel, started)
            .map_err(Stopped::conversion)?
        {
            return Err("The WebP converter could not convert this file.".into());
        }
    }
    if cancel.load(Ordering::Acquire) {
        return Err("Conversion cancelled.".into());
    }
    let output = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&output_path)
        .map_err(|_| "Conversion produced no output.")?;
    let bytes = output
        .metadata()
        .map_err(|_| "Conversion produced no output.")?
        .len();
    if bytes == 0 || bytes > MAX_OUTPUT {
        return Err("Converted output must be between one byte and 256 MB.".into());
    }
    keep(output)
}

/// The converted file, past the sandbox's removal. On macOS the open
/// descriptor survives it; Windows can't remove a folder holding an open
/// file, so the output is copied to an anonymous file first.
fn keep(output: File) -> Result<File, String> {
    #[cfg(windows)]
    {
        use std::io::{Read, Seek};
        let mut kept = tempfile::tempfile().map_err(|_| "Could not keep the converted file.")?;
        std::io::copy(&mut (&output).take(MAX_OUTPUT + 1), &mut kept)
            .map_err(|_| "Could not keep the converted file.")?;
        kept.seek(std::io::SeekFrom::Start(0))
            .map_err(|_| "Could not keep the converted file.")?;
        Ok(kept)
    }
    #[cfg(not(windows))]
    Ok(output)
}

/// A separately installed WebP encoder, on macOS only: Windows FFmpeg
/// builds carry WebP themselves.
fn webp_encoder() -> Option<std::path::PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    ["/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp"]
        .into_iter()
        .find_map(|path| Path::new(path).canonicalize().ok())
}

fn options(format: &str, quality: &str) -> Vec<&'static str> {
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
        "mp3" => vec!["-vn", "-codec:a", "libmp3lame", "-b:a", audio],
        "m4a" => vec!["-vn", "-c:a", "aac", "-b:a", audio],
        "mp4" | "mov" => vec![
            "-c:v",
            "libx264",
            "-crf",
            crf,
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ],
        "webm" => vec![
            "-c:v",
            "libvpx-vp9",
            "-crf",
            crf,
            "-b:v",
            "0",
            "-c:a",
            "libopus",
        ],
        "gif" => vec![
            "-vf",
            "fps=12:round=up,scale='min(960,iw)':-1:flags=lanczos",
        ],
        "jpg" => vec![
            "-frames:v",
            "1",
            "-q:v",
            if quality == "high" { "2" } else { "5" },
        ],
        "png" | "webp" | "avif" => vec!["-frames:v", "1"],
        _ => Vec::new(),
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::super::super::tool_sandbox::fixtures::*;
    use super::*;

    #[test]
    fn real_ffmpeg_converts_inside_the_container() {
        let Some((_copy, executable)) = private_ffmpeg() else {
            eprintln!("FFmpeg unavailable: real conversion check skipped.");
            return;
        };
        let fixture = tempfile::tempdir().unwrap();
        let input = fixture.path().join("tone.wav");
        wav(&input);
        for format in ["mp3", "png"] {
            let source = if format == "mp3" {
                input.clone()
            } else {
                let visual = fixture.path().join("input.ppm");
                let mut pixels = b"P6\n16 16\n255\n".to_vec();
                pixels.extend(vec![127; 16 * 16 * 3]);
                std::fs::write(&visual, pixels).unwrap();
                visual
            };
            let result = convert(
                &executable,
                &File::open(&source).unwrap(),
                format,
                "balanced",
                &AtomicBool::new(false),
            )
            .unwrap_or_else(|error| panic!("{format}: {error}"));
            assert!(result.metadata().unwrap().len() > 0, "{format}");
        }
        assert_eq!(std::fs::metadata(input).unwrap().len(), 1644);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::super::super::tool_sandbox::fixtures::*;
    use super::*;

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
}
