//! The Code page's native side: language servers (`lsp`), database connections (`db`), live
//! sessions (`live`), a file as Git last committed it (`git_text`) and reading the person's own
//! Neovim mappings (`nvim`). Every folder a window
//! names is checked against the folders the account linked, like the project panels
//! (`crate::project::linked_path`).

pub mod db;
pub mod git_text;
pub mod live;
pub mod lsp;
pub mod nvim;
