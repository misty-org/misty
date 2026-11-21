// The code views a UI rule leaves alone. Runs under plain Node with uiRules.ts, so it imports nothing.

/** Monospace belongs to code itself: the editor, the terminal, diffs and markdown code blocks. */
export const codeViews = [
  /^src\/features\/agents\/context-panel\/editor\//,
  /^src\/features\/agents\/context-panel\/terminal\//,
  /^src\/features\/agents\/context-panel\/git\/DiffView\.tsx$/,
  /^src\/features\/agents\/runs\/markdown\//,
  /^src\/shared\/lib\/terminal\//,
  // The code editor's own theme, and the Code page's editors and SQL grid built on it.
  /^src\/shared\/lib\/codemirror\//,
  // A text file's own contents, shown as the file.
  /^src\/features\/spaces\/library\/library-primitives\/LibraryTextPreview\.tsx$/,
  /^src\/features\/files\/preview\/EmbeddedUniversalPreviewView\.tsx$/,
] as const;
