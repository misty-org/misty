//! The built-in keyboard shortcut table.
//!
//! Split out of `commands.rs` purely for size: this is a flat per-OS data
//! table, while that file is the read/merge/write logic around it.

#[derive(Debug, Clone, Copy)]
pub(super) struct DefaultCommandEntry {
    pub(super) id: &'static str,
    pub(super) shortcut: &'static str,
}

pub(super) fn default_command_entries() -> &'static [DefaultCommandEntry] {
    #[cfg(target_os = "macos")]
    {
        const ENTRIES: &[DefaultCommandEntry] = &[
            DefaultCommandEntry {
                id: "search.toggle",
                shortcut: "Cmd+K",
            },
            DefaultCommandEntry {
                id: "search.cancel",
                shortcut: "Escape",
            },
            DefaultCommandEntry {
                id: "search.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "search.prev",
                shortcut: "Up",
            },
            DefaultCommandEntry {
                id: "search.next",
                shortcut: "Down",
            },
            DefaultCommandEntry {
                id: "explorer.open_palette",
                shortcut: "Cmd+P",
            },
            DefaultCommandEntry {
                id: "code.quick_open",
                shortcut: "Cmd+P",
            },
            DefaultCommandEntry {
                id: "code.command_palette",
                shortcut: "Cmd+Shift+P",
            },
            DefaultCommandEntry {
                id: "code.search_project",
                shortcut: "Cmd+Shift+F",
            },
            DefaultCommandEntry {
                id: "code.harpoon",
                shortcut: "Ctrl+E",
            },
            DefaultCommandEntry {
                id: "code.previous_file",
                shortcut: "Ctrl+O",
            },
            DefaultCommandEntry {
                id: "code.toggle_explorer",
                shortcut: "Cmd+B",
            },
            DefaultCommandEntry {
                id: "code.toggle_terminal",
                shortcut: "Cmd+J",
            },
            DefaultCommandEntry {
                id: "code.mark_1",
                shortcut: "Alt+1",
            },
            DefaultCommandEntry {
                id: "code.mark_2",
                shortcut: "Alt+2",
            },
            DefaultCommandEntry {
                id: "code.mark_3",
                shortcut: "Alt+3",
            },
            DefaultCommandEntry {
                id: "code.mark_4",
                shortcut: "Alt+4",
            },
            DefaultCommandEntry {
                id: "explorer.copy",
                shortcut: "Cmd+C",
            },
            DefaultCommandEntry {
                id: "explorer.cut",
                shortcut: "Cmd+X",
            },
            DefaultCommandEntry {
                id: "explorer.paste",
                shortcut: "Cmd+V",
            },
            DefaultCommandEntry {
                id: "explorer.undo",
                shortcut: "Cmd+Z",
            },
            DefaultCommandEntry {
                id: "explorer.redo",
                shortcut: "Cmd+Shift+Z",
            },
            DefaultCommandEntry {
                id: "explorer.delete",
                shortcut: "Delete",
            },
            DefaultCommandEntry {
                id: "explorer.rename",
                shortcut: "F2",
            },
            DefaultCommandEntry {
                id: "explorer.refresh",
                shortcut: "Cmd+R",
            },
            DefaultCommandEntry {
                id: "explorer.next_workspace",
                shortcut: "Cmd+Shift+Grave",
            },
            DefaultCommandEntry {
                id: "explorer.new_tab",
                shortcut: "Cmd+T",
            },
            DefaultCommandEntry {
                id: "explorer.restore_tab",
                shortcut: "Cmd+Shift+T",
            },
            DefaultCommandEntry {
                id: "explorer.close_pane",
                shortcut: "Cmd+W",
            },
            DefaultCommandEntry {
                id: "explorer.restore_pane",
                shortcut: "Cmd+Ctrl+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_vertical",
                shortcut: "Cmd+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_horizontal",
                shortcut: "Cmd+Shift+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.tab_1",
                shortcut: "Cmd+1",
            },
            DefaultCommandEntry {
                id: "explorer.tab_2",
                shortcut: "Cmd+2",
            },
            DefaultCommandEntry {
                id: "explorer.tab_3",
                shortcut: "Cmd+3",
            },
            DefaultCommandEntry {
                id: "explorer.tab_4",
                shortcut: "Cmd+4",
            },
            DefaultCommandEntry {
                id: "explorer.tab_5",
                shortcut: "Cmd+5",
            },
            DefaultCommandEntry {
                id: "explorer.tab_6",
                shortcut: "Cmd+6",
            },
            DefaultCommandEntry {
                id: "explorer.tab_7",
                shortcut: "Cmd+7",
            },
            DefaultCommandEntry {
                id: "explorer.tab_8",
                shortcut: "Cmd+8",
            },
            DefaultCommandEntry {
                id: "explorer.tab_9",
                shortcut: "Cmd+9",
            },
            DefaultCommandEntry {
                id: "app.open_settings",
                shortcut: "Cmd+Comma",
            },
            DefaultCommandEntry {
                id: "app.toggle_plugin_launcher",
                shortcut: "Cmd+Shift+P",
            },
            DefaultCommandEntry {
                id: "app.toggle_transfers",
                shortcut: "Cmd+Shift+Y",
            },
            DefaultCommandEntry {
                id: "clipboard.publish_shared",
                shortcut: "Cmd+Alt+C",
            },
            DefaultCommandEntry {
                id: "clipboard.apply_shared",
                shortcut: "Cmd+Alt+V",
            },
            DefaultCommandEntry {
                id: "modal.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "modal.cancel",
                shortcut: "Escape",
            },
        ];
        ENTRIES
    }

    #[cfg(not(target_os = "macos"))]
    {
        const ENTRIES: &[DefaultCommandEntry] = &[
            DefaultCommandEntry {
                id: "search.toggle",
                shortcut: "Ctrl+K",
            },
            DefaultCommandEntry {
                id: "search.cancel",
                shortcut: "Escape",
            },
            DefaultCommandEntry {
                id: "search.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "search.prev",
                shortcut: "Up",
            },
            DefaultCommandEntry {
                id: "search.next",
                shortcut: "Down",
            },
            DefaultCommandEntry {
                id: "explorer.open_palette",
                shortcut: "Ctrl+P",
            },
            DefaultCommandEntry {
                id: "code.quick_open",
                shortcut: "Ctrl+P",
            },
            DefaultCommandEntry {
                id: "code.command_palette",
                shortcut: "Ctrl+Shift+P",
            },
            DefaultCommandEntry {
                id: "code.search_project",
                shortcut: "Ctrl+Shift+F",
            },
            DefaultCommandEntry {
                id: "code.harpoon",
                shortcut: "Ctrl+E",
            },
            DefaultCommandEntry {
                id: "code.previous_file",
                shortcut: "Ctrl+O",
            },
            DefaultCommandEntry {
                id: "code.toggle_explorer",
                shortcut: "Ctrl+B",
            },
            DefaultCommandEntry {
                id: "code.toggle_terminal",
                shortcut: "Ctrl+J",
            },
            DefaultCommandEntry {
                id: "code.mark_1",
                shortcut: "Alt+1",
            },
            DefaultCommandEntry {
                id: "code.mark_2",
                shortcut: "Alt+2",
            },
            DefaultCommandEntry {
                id: "code.mark_3",
                shortcut: "Alt+3",
            },
            DefaultCommandEntry {
                id: "code.mark_4",
                shortcut: "Alt+4",
            },
            DefaultCommandEntry {
                id: "explorer.copy",
                shortcut: "Ctrl+C",
            },
            DefaultCommandEntry {
                id: "explorer.cut",
                shortcut: "Ctrl+X",
            },
            DefaultCommandEntry {
                id: "explorer.paste",
                shortcut: "Ctrl+V",
            },
            DefaultCommandEntry {
                id: "explorer.undo",
                shortcut: "Ctrl+Z",
            },
            DefaultCommandEntry {
                id: "explorer.redo",
                shortcut: "Ctrl+Shift+Z",
            },
            DefaultCommandEntry {
                id: "explorer.delete",
                shortcut: "Delete",
            },
            DefaultCommandEntry {
                id: "explorer.rename",
                shortcut: "F2",
            },
            DefaultCommandEntry {
                id: "explorer.refresh",
                shortcut: "Ctrl+R",
            },
            DefaultCommandEntry {
                id: "explorer.next_workspace",
                shortcut: "Ctrl+Shift+Grave",
            },
            DefaultCommandEntry {
                id: "explorer.new_tab",
                shortcut: "Ctrl+T",
            },
            DefaultCommandEntry {
                id: "explorer.restore_tab",
                shortcut: "Ctrl+Shift+T",
            },
            DefaultCommandEntry {
                id: "explorer.close_pane",
                shortcut: "Ctrl+W",
            },
            DefaultCommandEntry {
                id: "explorer.restore_pane",
                shortcut: "Ctrl+Ctrl+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_vertical",
                shortcut: "Ctrl+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_horizontal",
                shortcut: "Ctrl+Shift+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.tab_1",
                shortcut: "Ctrl+1",
            },
            DefaultCommandEntry {
                id: "explorer.tab_2",
                shortcut: "Ctrl+2",
            },
            DefaultCommandEntry {
                id: "explorer.tab_3",
                shortcut: "Ctrl+3",
            },
            DefaultCommandEntry {
                id: "explorer.tab_4",
                shortcut: "Ctrl+4",
            },
            DefaultCommandEntry {
                id: "explorer.tab_5",
                shortcut: "Ctrl+5",
            },
            DefaultCommandEntry {
                id: "explorer.tab_6",
                shortcut: "Ctrl+6",
            },
            DefaultCommandEntry {
                id: "explorer.tab_7",
                shortcut: "Ctrl+7",
            },
            DefaultCommandEntry {
                id: "explorer.tab_8",
                shortcut: "Ctrl+8",
            },
            DefaultCommandEntry {
                id: "explorer.tab_9",
                shortcut: "Ctrl+9",
            },
            DefaultCommandEntry {
                id: "app.open_settings",
                shortcut: "Ctrl+Comma",
            },
            DefaultCommandEntry {
                id: "app.toggle_plugin_launcher",
                shortcut: "Ctrl+Shift+P",
            },
            DefaultCommandEntry {
                id: "app.toggle_transfers",
                shortcut: "Ctrl+Shift+Y",
            },
            DefaultCommandEntry {
                id: "clipboard.publish_shared",
                shortcut: "Ctrl+Alt+C",
            },
            DefaultCommandEntry {
                id: "clipboard.apply_shared",
                shortcut: "Ctrl+Alt+V",
            },
            DefaultCommandEntry {
                id: "modal.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "modal.cancel",
                shortcut: "Escape",
            },
        ];
        ENTRIES
    }
}
