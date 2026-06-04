# Refactor Log

## File Explorer FileMaster Integration

- 2026-05-26: Refactor 1 complete. Centralized FileMaster-capable item and selection checks in `file_explorer_content_util` and updated explorer operations, context menus, and toolbar to use the shared helpers.
- 2026-05-26: Refactor 2 complete. Moved FileItem-to-FileMasterProps construction into shared file explorer utilities and updated the operation layer to use them.
- 2026-05-26: Refactor 3 complete. Centralized local/remote FileMaster operation dispatch helpers for paste, remove, and rename inside the explorer operation layer.
- 2026-05-26: Refactor 4 complete. Moved selected-item resolution and FileItem lookup helpers into shared file explorer utilities.
- 2026-05-26: Refactor 5 complete. Extracted FileMaster operation dispatch into a dedicated file explorer operations helper module.
- 2026-05-26: Refactor 6 complete. Moved remote download FileMaster orchestration into the file explorer operations helper module.
- 2026-05-26: Refactor 7 complete. Extracted file explorer download and sync notifications into a dedicated operations notification helper.
