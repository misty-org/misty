// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * The Skills page's English text, from desktop-cc-gui's `en.ts` (`skills.*`), in Misty's
 * sentence case. `t()` reads a dotted key and fills `{{name}}` placeholders, so the panes keep
 * the shape of the code they came from without an i18n library.
 */

const strings = {
  tabs: {
    installed: "My skills",
    discover: "Discover",
    usage: "Usage",
  },
  source: {
    managed: "Managed",
    local: "Local",
    builtin: "Built-in",
    system: "System",
    plugin: "Plugin",
  },
  targetState: {
    off: "No copy for {{engine}}",
    synced: "Synced to {{engine}}",
    orphan: "Copy missing for {{engine}}",
  },
  targetStateShort: {
    off: "No copy",
    synced: "Synced",
    orphan: "Copy missing",
  },
  orphanHint: "Copy missing",
  searchPlaceholder: "Search name, description or folder",
  refresh: "Check for updates",
  count: "{{count}} of {{total}} skills",
  updatesAvailable: "{{count}} with updates",
  filter: {
    allEngines: "All engines",
  },
  empty: {
    none: "No skills installed yet",
    filtered: "No skill matches these filters",
    browse: "Browse skills",
  },
  row: {
    open: "Show {{name}}",
    engines: "Engines with {{name}}",
    localCopyLocked: "Your own local copy; Misty never deletes it",
  },
  actions: {
    import: "Adopt",
    importLocal: "Import local skill",
    deleteLocal: "Delete local skill",
    uninstall: "Uninstall",
    update: "Update",
  },
  readonly: {
    managed: "Managed skills are uninstalled here; an engine's copy can't be deleted on its own.",
    local: "Local skills can be adopted or deleted.",
    builtin: "Ships with Misty; never synced or deleted here.",
    system: "Ships with the engine; read-only here.",
    plugin: "Comes with a plugin; manage it with the plugin.",
  },
  detail: {
    title: "{{name}}",
    repository: "Repository",
    directory: "Folder",
    paths: "Copies",
    activity: "Activity",
    invocations: "Invocations",
    lastUsed: "Last used",
    neverUsed: "Never used",
    unusedHint: "Never invoked. If you never use it, it may just be dead weight.",
    usageUnavailable: "Usage is unavailable: only Claude Code session transcripts can be scanned.",
    syncTo: "Sync to",
    hiddenEngines:
      "{{count}} more engines aren't installed; they show here once their CLI is installed.",
    removeAll: "Remove from every engine",
    removeAllHint: "Unsyncs every engine and deletes the local copy.",
    targets: "Engines",
    promoteHint:
      "Ticking any engine adopts this skill as a managed copy; your own local folder is never deleted.",
    contentLoading: "Reading SKILL.md",
    contentTruncated: "This file is long; only the beginning is shown.",
  },
  feedback: {
    syncedAll: "{{name}} synced to every engine",
    syncedPartial: "{{name}} failed on {{failed}}",
    syncedOne: "{{name}} synced to {{engine}}",
    unsyncedOne: "{{name}} removed from {{engine}}",
    keptLocal: "{{name}} kept your own local copy ({{engine}})",
    syncFailed: "{{engine}} failed: {{error}}",
    updated: "{{name}} updated",
    installed: "{{name}} installed",
    uninstalled: "{{name}} uninstalled. You can undo this for 5 minutes.",
    restored: "Skill restored",
    restoreNow: "Undo uninstall",
  },
  import: {
    title: "Import a local skill",
    directoryLabel: "Folder inside an engine's skills folder",
    directoryPlaceholder: "my-skill or group/my-skill",
    pick: "Choose folder…",
    pickTitle: "Choose a skill folder",
    outsideRoots: "That folder isn't inside an engine's skills folder:\n{{roots}}",
    targets: "Sync to",
    confirm: "Import",
  },
  discover: {
    searchPlaceholder: "Search skills.sh",
    search: "Search",
    searchHint: "Type at least 2 characters to search.",
    resultCount: "{{count}} results",
    clearSearch: "Back to browse",
    popular: "Popular",
    repos: "Repositories",
    popularHint: "Popular skills from skills.sh, refreshed every 6 hours.",
    reposHint: "{{count}} repositories. Scan them to refresh the list.",
    cached: "cached",
    manageRepos: "Manage repositories",
    scan: "Scan repositories",
    install: "Install",
    installed: "Installed",
    installs: "{{count}} installs",
    noResults: "No matching skill",
    none: "Nothing to show yet",
    open: "Show {{name}}",
    detailTitle: "{{name}}",
    contentLoading: "Reading SKILL.md from the repository",
    contentMissing:
      "This repository has no SKILL.md for this skill. It may have been renamed or removed; open the repository to check.",
    contentFailed: "SKILL.md couldn't be read (a GitHub rate limit or a network problem).",
    openRepo: "Open repository",
    retry: "Try again",
    installTargets: "Installs into the Claude Code and Codex skills folders.",
  },
  repos: {
    title: "Skill repositories",
    owner: "Owner",
    name: "Repository",
    branch: "Branch",
    add: "Add repository",
    remove: "Remove",
  },
  usage: {
    scope:
      "Counted from Claude Code session transcripts only (following CLAUDE_CONFIG_DIR). Other engines keep no readable record of skill calls.",
    invocations: "Skill invocations",
    noData: "No session transcripts to read yet",
    noInvocations: "No skill invocations in the transcripts",
    summary: "{{files}} transcripts read, {{total}} invocations.",
    skill: "Skill",
    calls: "Calls",
    tokens: "Tokens",
    lastUsed: "Last used",
    today: "Today",
    daysAgo: "{{days}}d ago",
    monthsAgo: "{{months}}mo ago",
    unused:
      "{{count}} installed skills weren't seen being invoked, which doesn't prove they never were.",
  },
  activity: {
    title: "Changes",
    scope: "Installs, uninstalls, syncs and deletes made in Misty.",
    empty: "No changes yet",
    action: {
      install: "Install",
      uninstall: "Uninstall",
      restore: "Restore",
      setTargets: "Engines",
      import: "Import",
      deleteLocal: "Delete local",
      other: "Change",
    },
  },
  confirm: {
    title: "Confirm",
    uninstallTitle: "Uninstall {{name}}?",
    uninstallBody:
      "Every engine copy Misty made is removed and the managed original moves to the trash, where it can be restored for 5 minutes.",
    deleteTitle: "Delete {{name}}?",
    deleteBody: "These skill folders are deleted from disk, and Misty can't restore them.",
    overwriteTitle: "{{name}} has local changes",
    overwriteBody:
      "Updating replaces your changes to the managed copy with the repository's version. Back them up first to keep them.",
    overwriteConfirm: "Replace and update",
  },
  common: {
    refresh: "Refresh",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    delete: "Delete",
  },
} as const;

type Vars = Record<string, string | number>;

/** The text at a dotted key such as `feedback.installed`, with `{{name}}` filled from `vars`. */
export function t(key: string, vars: Vars = {}): string {
  let node: unknown = strings;
  for (const part of key.split(".")) {
    node =
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  const text = typeof node === "string" ? node : key;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
