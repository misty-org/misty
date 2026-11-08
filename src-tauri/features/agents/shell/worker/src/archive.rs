//! `tar`, `zip`, `unzip`, `gzip` and `gunzip`, which uutils doesn't have in a finished form yet. Only
//! the forms people actually use, and anything else says so rather than guessing.
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::{self, BufReader, Read, Write},
    path::{Path, PathBuf},
};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};

fn failed(tool: &str, error: impl std::fmt::Display) -> i32 {
    eprintln!("{tool}: {error}");
    1
}

fn report(tool: &str, result: io::Result<()>) -> i32 {
    match result {
        Ok(()) => 0,
        Err(error) => failed(tool, error),
    }
}

// tar

#[derive(Default)]
struct TarArgs {
    create: bool,
    extract: bool,
    list: bool,
    gzip: bool,
    verbose: bool,
    archive: Option<PathBuf>,
    into: Option<PathBuf>,
    paths: Vec<PathBuf>,
}

fn parse_tar(args: &[OsString]) -> Result<TarArgs, String> {
    let mut parsed = TarArgs::default();
    let mut rest = args.iter();
    let mut first = true;
    while let Some(arg) = rest.next() {
        let text = arg.to_string_lossy();
        // `tar czf x.tgz` and `tar -czf x.tgz` mean the same; only the first word can drop the dash.
        let letters = match text.strip_prefix('-') {
            Some(letters) if !letters.starts_with('-') && !letters.is_empty() => Some(letters),
            _ if first && !text.starts_with('-') => Some(text.as_ref()),
            _ => None,
        };
        first = false;
        if text == "-C" || text == "--directory" {
            parsed.into = Some(rest.next().ok_or("-C needs a folder")?.into());
            continue;
        }
        let Some(letters) = letters else {
            if text.starts_with("--") {
                return Err(format!("{text}: not supported"));
            }
            parsed.paths.push(arg.into());
            continue;
        };
        for letter in letters.chars() {
            match letter {
                'c' => parsed.create = true,
                'x' => parsed.extract = true,
                't' => parsed.list = true,
                'z' => parsed.gzip = true,
                'v' => parsed.verbose = true,
                'f' => parsed.archive = Some(rest.next().ok_or("-f needs a file")?.into()),
                other => return Err(format!("-{other}: not supported")),
            }
        }
    }
    if [parsed.create, parsed.extract, parsed.list].iter().filter(|on| **on).count() != 1 {
        return Err("say one of -c, -x or -t".to_owned());
    }
    if parsed.archive.is_none() {
        return Err("say which archive with -f".to_owned());
    }
    Ok(parsed)
}

fn compressed_by_name(path: &Path) -> bool {
    let name = path.to_string_lossy().to_ascii_lowercase();
    name.ends_with(".tgz") || name.ends_with(".tar.gz")
}

fn tar_create(archive: &Path, base: &Path, paths: &[PathBuf], gzip: bool) -> io::Result<()> {
    if paths.is_empty() {
        return Err(io::Error::other("nothing to add"));
    }
    let file = File::create(archive)?;
    let writer: Box<dyn Write> = if gzip || compressed_by_name(archive) {
        Box::new(GzEncoder::new(file, Compression::default()))
    } else {
        Box::new(file)
    };
    let mut builder = tar::Builder::new(writer);
    builder.follow_symlinks(false);
    for path in paths {
        let full = base.join(path);
        if full.is_dir() {
            builder.append_dir_all(path, &full)?;
        } else {
            builder.append_path_with_name(&full, path)?;
        }
    }
    builder.into_inner()?.flush()
}

fn tar_reader(archive: &Path, gzip: bool) -> io::Result<tar::Archive<Box<dyn Read>>> {
    let file = BufReader::new(File::open(archive)?);
    let reader: Box<dyn Read> = if gzip || compressed_by_name(archive) {
        Box::new(GzDecoder::new(file))
    } else {
        Box::new(file)
    };
    Ok(tar::Archive::new(reader))
}

pub fn tar(args: &[OsString]) -> i32 {
    let parsed = match parse_tar(args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("tar: {message}");
            return 2;
        }
    };
    let Some(archive) = parsed.archive.as_deref() else {
        return 2;
    };
    let base = parsed.into.clone().unwrap_or_else(|| PathBuf::from("."));
    let result = if parsed.create {
        tar_create(archive, &base, &parsed.paths, parsed.gzip)
    } else if parsed.list {
        tar_reader(archive, parsed.gzip).and_then(|mut tar| {
            for entry in tar.entries()? {
                println!("{}", entry?.path()?.display());
            }
            Ok(())
        })
    } else {
        // `unpack` refuses anything that would land outside `base`, like `../x` or a link out.
        tar_reader(archive, parsed.gzip).and_then(|mut tar| {
            if parsed.verbose {
                for entry in tar.entries()? {
                    let mut entry = entry?;
                    println!("{}", entry.path()?.display());
                    entry.unpack_in(&base)?;
                }
                Ok(())
            } else {
                tar.unpack(&base)
            }
        })
    };
    report("tar", result)
}

// zip

fn add_to_zip<W: Write + io::Seek>(writer: &mut zip::ZipWriter<W>, path: &Path) -> Result<(), String> {
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let name = path.to_string_lossy().replace('\\', "/");
    let kind = std::fs::symlink_metadata(path).map_err(|error| format!("{name}: {error}"))?;
    if kind.is_dir() {
        writer
            .add_directory(format!("{}/", name.trim_end_matches('/')), options)
            .map_err(|error| format!("{name}: {error}"))?;
        for entry in std::fs::read_dir(path).map_err(|error| format!("{name}: {error}"))? {
            let entry = entry.map_err(|error| format!("{name}: {error}"))?;
            add_to_zip(writer, &entry.path())?;
        }
    } else if kind.is_file() {
        writer.start_file(name.as_str(), options).map_err(|error| format!("{name}: {error}"))?;
        let mut file = File::open(path).map_err(|error| format!("{name}: {error}"))?;
        io::copy(&mut file, writer).map_err(|error| format!("{name}: {error}"))?;
    }
    // A link is left out: following it could copy something from outside the folder being zipped.
    Ok(())
}

/// `zip [-r] out.zip paths...`. Folders are always added whole, whether or not `-r` is given.
pub fn zip(args: &[OsString]) -> i32 {
    let mut names = args.iter().filter(|arg| !matches!(arg.to_str(), Some("-r" | "-q")));
    let Some(archive) = names.next() else {
        return failed("zip", "say which archive to write");
    };
    let paths: Vec<&OsString> = names.collect();
    if paths.is_empty() {
        return failed("zip", "nothing to add");
    }
    let run = || -> Result<(), String> {
        let file = File::create(archive).map_err(|error| error.to_string())?;
        let mut writer = zip::ZipWriter::new(file);
        for path in paths {
            add_to_zip(&mut writer, Path::new(path))?;
        }
        writer.finish().map_err(|error| error.to_string())?;
        Ok(())
    };
    match run() {
        Ok(()) => 0,
        Err(error) => failed("zip", error),
    }
}

/// `unzip [-q] [-o] file.zip [-d folder]`.
pub fn unzip(args: &[OsString]) -> i32 {
    let mut archive: Option<&OsStr> = None;
    let mut into = PathBuf::from(".");
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.to_str() {
            Some("-q" | "-o") => {}
            Some("-d") => match rest.next() {
                Some(folder) => into = folder.into(),
                None => return failed("unzip", "-d needs a folder"),
            },
            _ if archive.is_none() => archive = Some(arg),
            _ => return failed("unzip", "picking single files isn't supported"),
        }
    }
    let Some(archive) = archive else {
        return failed("unzip", "say which archive to read");
    };
    let run = || -> Result<(), String> {
        let file = File::open(archive).map_err(|error| error.to_string())?;
        let mut zip = zip::ZipArchive::new(BufReader::new(file)).map_err(|error| error.to_string())?;
        // `extract` keeps every file inside the folder, whatever names the archive holds.
        zip.extract(&into).map_err(|error| error.to_string())
    };
    match run() {
        Ok(()) => 0,
        Err(error) => failed("unzip", error),
    }
}

// gzip

/// `gzip file`, `gzip -k file`, `gzip -c file` or `gzip` on a pipe.
fn gzip_args(args: &[OsString]) -> (bool, bool, Vec<&OsString>) {
    let (mut keep, mut to_stdout, mut files) = (false, false, Vec::new());
    for arg in args {
        match arg.to_str() {
            Some("-k") => keep = true,
            Some("-c") => to_stdout = true,
            _ => files.push(arg),
        }
    }
    (keep, to_stdout, files)
}

pub fn gzip(args: &[OsString]) -> i32 {
    let (keep, to_stdout, files) = gzip_args(args);
    if files.is_empty() {
        let mut encoder = GzEncoder::new(io::stdout().lock(), Compression::default());
        let done = io::copy(&mut io::stdin().lock(), &mut encoder).and_then(|_| encoder.try_finish());
        return report("gzip", done);
    }
    for path in files {
        let done = (|| -> io::Result<()> {
            let mut input = File::open(path)?;
            if to_stdout {
                let mut encoder = GzEncoder::new(io::stdout().lock(), Compression::default());
                io::copy(&mut input, &mut encoder)?;
                return encoder.try_finish();
            }
            let mut name = path.clone();
            name.push(".gz");
            let mut encoder = GzEncoder::new(File::create(&name)?, Compression::default());
            io::copy(&mut input, &mut encoder)?;
            encoder.try_finish()?;
            if !keep {
                std::fs::remove_file(path)?;
            }
            Ok(())
        })();
        if report("gzip", done) != 0 {
            return 1;
        }
    }
    0
}

pub fn gunzip(args: &[OsString]) -> i32 {
    let (keep, to_stdout, files) = gzip_args(args);
    if files.is_empty() {
        let done = io::copy(&mut GzDecoder::new(io::stdin().lock()), &mut io::stdout().lock()).map(|_| ());
        return report("gunzip", done);
    }
    for path in files {
        let done = (|| -> io::Result<()> {
            let mut decoder = GzDecoder::new(BufReader::new(File::open(path)?));
            if to_stdout {
                io::copy(&mut decoder, &mut io::stdout().lock())?;
                return Ok(());
            }
            let Some(name) = Path::new(path).to_str().and_then(|name| name.strip_suffix(".gz")) else {
                return Err(io::Error::other("the name doesn't end in .gz"));
            };
            io::copy(&mut decoder, &mut File::create(name)?)?;
            if !keep {
                std::fs::remove_file(path)?;
            }
            Ok(())
        })();
        if report("gunzip", done) != 0 {
            return 1;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn args(words: &[&Path]) -> Vec<OsString> {
        words.iter().copied().map(OsString::from).collect()
    }

    fn word(text: &str) -> OsString {
        OsString::from(text)
    }

    /// Writes one file under `name` without the checks a normal archive writer makes, as a malicious
    /// archive would.
    fn hostile_tar(path: &Path, name: &str) {
        let mut header = tar::Header::new_old();
        header.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
        header.set_size(5);
        header.set_mode(0o644);
        header.set_cksum();
        let mut builder = tar::Builder::new(File::create(path).unwrap());
        builder.append(&header, &b"evil\n"[..]).unwrap();
        builder.finish().unwrap();
    }

    #[test]
    fn tar_goes_there_and_back_compressed() {
        let temp = tempfile::tempdir().unwrap();
        let from = temp.path().join("from");
        std::fs::create_dir_all(from.join("sub")).unwrap();
        std::fs::write(from.join("sub/f.txt"), "kept").unwrap();
        let archive = temp.path().join("a.tar.gz");
        let into = temp.path().join("into");
        std::fs::create_dir(&into).unwrap();
        let made = tar(&[word("-czf"), archive.clone().into(), word("-C"), temp.path().into(), word("from")]);
        assert_eq!(made, 0);
        assert_eq!(tar(&[word("-xzf"), archive.into(), word("-C"), into.clone().into()]), 0);
        assert_eq!(std::fs::read_to_string(into.join("from/sub/f.txt")).unwrap(), "kept");
    }

    #[test]
    fn a_tar_cant_write_outside_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let into = temp.path().join("deep/into");
        std::fs::create_dir_all(&into).unwrap();
        let archive = temp.path().join("evil.tar");
        hostile_tar(&archive, "../../escaped.txt");
        let _ = tar(&[word("-xf"), archive.into(), word("-C"), into.into()]);
        assert!(!temp.path().join("escaped.txt").exists());
        assert!(!temp.path().join("deep/escaped.txt").exists());
    }

    #[test]
    fn a_zip_cant_write_outside_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let into = temp.path().join("deep/into");
        std::fs::create_dir_all(&into).unwrap();
        let archive = temp.path().join("evil.zip");
        let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
        writer.start_file("../../escaped.txt", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"evil").unwrap();
        writer.finish().unwrap();
        let _ = unzip(&[archive.into(), word("-d"), into.into()]);
        assert!(!temp.path().join("escaped.txt").exists());
        assert!(!temp.path().join("deep/escaped.txt").exists());
    }

    #[test]
    fn a_zip_doesnt_follow_links_out_of_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let secret = temp.path().join("secret.txt");
        std::fs::write(&secret, "secret").unwrap();
        let folder = temp.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("ok.txt"), "fine").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&secret, folder.join("link.txt")).unwrap();
        let archive = temp.path().join("a.zip");
        let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
        add_to_zip(&mut writer, &folder).unwrap();
        writer.finish().unwrap();
        let mut bytes = Vec::new();
        File::open(&archive).unwrap().read_to_end(&mut bytes).unwrap();
        assert!(!bytes.windows(6).any(|window| window == b"secret"));
    }

    #[test]
    fn gzip_goes_there_and_back() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("a.txt");
        std::fs::write(&file, "hello").unwrap();
        assert_eq!(gzip(&args(&[&file])), 0);
        assert!(!file.exists());
        assert_eq!(gunzip(&args(&[&temp.path().join("a.txt.gz")])), 0);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello");
    }

    #[test]
    fn anything_it_doesnt_handle_says_so() {
        assert_eq!(tar(&[word("-xf")]), 2);
        assert_eq!(tar(&[word("--exclude=x"), word("-cf"), word("a.tar"), word("b")]), 2);
        assert_eq!(tar(&[word("-cxf"), word("a.tar")]), 2);
    }
}
