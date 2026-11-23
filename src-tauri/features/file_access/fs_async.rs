use std::{io, path::Path};

use super::{check, check_link, Access};

pub async fn create_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    tokio::fs::create_dir_all(path).await
}

pub async fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    tokio::fs::write(path, contents).await
}

pub async fn open_for_asset_protocol(path: impl AsRef<Path>) -> io::Result<tokio::fs::File> {
    tokio::fs::File::open(path).await
}

pub async fn read(path: impl AsRef<Path>) -> io::Result<Vec<u8>> {
    check(path.as_ref(), Access::Read)?;
    tokio::fs::read(path).await
}

pub async fn read_to_string(path: impl AsRef<Path>) -> io::Result<String> {
    check(path.as_ref(), Access::Read)?;
    tokio::fs::read_to_string(path).await
}

pub async fn metadata(path: impl AsRef<Path>) -> io::Result<std::fs::Metadata> {
    check(path.as_ref(), Access::Read)?;
    tokio::fs::metadata(path).await
}

pub async fn remove_file(path: impl AsRef<Path>) -> io::Result<()> {
    check_link(path.as_ref(), Access::Write)?;
    tokio::fs::remove_file(path).await
}

pub async fn remove_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    check_link(path.as_ref(), Access::Write)?;
    tokio::fs::remove_dir_all(path).await
}

pub async fn copy(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<u64> {
    check(from.as_ref(), Access::Read)?;
    check(to.as_ref(), Access::Write)?;
    tokio::fs::copy(from, to).await
}

pub async fn open(path: impl AsRef<Path>) -> io::Result<tokio::fs::File> {
    check(path.as_ref(), Access::Read)?;
    tokio::fs::File::open(path).await
}
