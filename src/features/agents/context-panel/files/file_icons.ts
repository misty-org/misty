// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

const svg16 = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">${body}</svg>`;

const svg24 = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const FILE_SHAPE =
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';

const icon_folder = svg24(
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
);

const icon_folder_open = svg24(
  '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1' +
    ' 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
);

const icon_file = svg24(FILE_SHAPE);

const icon_file_text = svg24(
  `${FILE_SHAPE}<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
);

const icon_file_code = svg24(
  `${FILE_SHAPE}<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>`,
);

const lightness = (hex: string): number => {
  const value = parseInt(hex.slice(1), 16);
  return (
    (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255
  );
};

const badgeText = (bg: string, fg: string, label: string, fontSize?: number): string => {
  const size = fontSize ?? (label.length > 2 ? 6.5 : 8.5);
  const color = lightness(bg) < 0.22 ? fg : bg;
  return svg16(
    `<text x="8" y="11" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${size}"` +
      ` font-weight="800" letter-spacing="-0.2" fill="${color}">${label}</text>`,
  );
};

const icon_js = badgeText("#F5DE19", "#33301C", "JS");
const icon_ts = badgeText("#3178C6", "#FFFFFF", "TS");
const icon_jsx = badgeText("#00D8FF", "#002C33", "JSX");
const icon_tsx = badgeText("#3178C6", "#FFFFFF", "TSX");
const icon_vue = badgeText("#41B883", "#35495E", "Vue");

const icon_java = badgeText("#EA2D2E", "#FFFFFF", "J");
const icon_kotlin = badgeText("#7F52FF", "#FFFFFF", "KT");

const icon_python = badgeText("#3776AB", "#FFD43B", "Py");
const icon_rust = badgeText("#CE412B", "#FFFFFF", "RS");
const icon_go = badgeText("#00ADD8", "#FFFFFF", "GO");
const icon_c = badgeText("#659AD2", "#FFFFFF", "C");
const icon_cpp = badgeText("#00599C", "#FFFFFF", "C++");
const icon_cs = badgeText("#178600", "#FFFFFF", "C#");
const icon_sql = badgeText("#E38C00", "#FFFFFF", "SQL");
const icon_xml = badgeText("#E44D26", "#FFFFFF", "XML");
const icon_php = badgeText("#777BB4", "#FFFFFF", "PHP");
const icon_ruby = badgeText("#CC342D", "#FFFFFF", "RB");
const icon_swift = badgeText("#F05138", "#FFFFFF", "SW");
const icon_gradle = badgeText("#02303A", "#00C7B7", "Gr");
const icon_properties = badgeText("#3E8E41", "#FFFFFF", "prop");
const icon_docker = badgeText("#2496ED", "#FFFFFF", "DK");

const icon_json = svg16(
  '<path d="M6.1 2.4c-1.35 0-2 .68-2 2.02v1.5c0 .9-.45 1.5-1.5 1.72v.72c1.05.22 1.5.82 1.5 1.72v1.5c0 1.34.65 2.02 2 2.02" stroke="#D9A62E"' +
    ' stroke-width="1.25" stroke-linecap="round"/>' +
    '<path d="M9.9 2.4c1.35 0 2 .68 2 2.02v1.5c0 .9.45 1.5 1.5 1.72v.72c-1.05.22-1.5.82-1.5 1.72v1.5c0 1.34-.65 2.02-2 2.02" stroke="#D9A62E"' +
    ' stroke-width="1.25" stroke-linecap="round"/>',
);

const icon_git = svg16(
  '<rect x="3.1" y="3.1" width="9.8" height="9.8" rx="1.8" transform="rotate(45 8 8)" fill="#F05133"/>' +
    '<circle cx="8" cy="5.3" r="1.05" fill="#fff"/><circle cx="8" cy="10.7" r="1.05" fill="#fff"/>' +
    '<path d="M8 6.4v3.2" stroke="#fff" stroke-width="1"/>',
);

const icon_markdown = svg16(
  '<path d="M2.2 11V5l2.6 3 2.6-3v6" stroke="#A8A29E" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M11.6 5v6m0 0-2-2.1m2 2.1 2-2.1" stroke="#A8A29E" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
);

const icon_lock = svg16(
  '<rect x="3.6" y="7.1" width="8.8" height="6.3" rx="1.6" fill="#E3B341"/><path d="M5.6 7V5.3a2.4 2.4 0 0 1 4.8 0V7" stroke="#E3B341" stroke-width="1.4"/>',
);

const icon_image = svg16(
  '<rect x="2" y="2.75" width="12" height="10.5" rx="1.75" stroke="#4CAF50" stroke-width="1.2"/><circle cx="5.8" cy="6.4" r="1.15" fill="#4CAF50"/>' +
    '<path d="m3.9 12.9 3.3-3.7a.9.9 0 0 1 1.34 0l3.36 3.7" stroke="#4CAF50" stroke-width="1.2" stroke-linecap="round"/>',
);

const icon_eslint = svg16(
  '<path d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z" fill="#4B32C3"/><path d="M8 4.7 10.9 6.35v3.3L8 11.3 5.1 9.65v-3.3Z" fill="#fff"/>',
);

const icon_nix = svg16(
  '<path d="M8 1.8v12.4M2.6 4.9l10.8 6.2M2.6 11.1 13.4 4.9" stroke="#7EBAE4" stroke-width="1.25" stroke-linecap="round"/>',
);

const icon_css = svg16(
  '<path d="M6.6 2.6 5 13.4M11 2.6 9.4 13.4M3.2 6h10.4M2.4 10h10.4" stroke="#4C97E4" stroke-width="1.25" stroke-linecap="round"/>',
);

const icon_html = svg16(
  '<path d="m5.6 4.6-3.2 3.4 3.2 3.4M10.4 4.6l3.2 3.4-3.2 3.4" stroke="#E44D26" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
);

const icon_shell = svg16(
  '<path d="m2.8 4.6 3.4 3.4-3.4 3.4" stroke="#4CAF50" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M8.4 11.4h4.8" stroke="#4CAF50" stroke-width="1.3" stroke-linecap="round"/>',
);

const icon_config = svg24(
  '<path d="M3 6h12M19 6h2M3 12h2M9 12h12M3 18h12M19 18h2"/><circle cx="17" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
);

const EXT_ICONS: Record<string, string> = {
  js: icon_js,
  jsx: icon_jsx,
  cjs: icon_js,
  mjs: icon_js,
  ts: icon_ts,
  tsx: icon_tsx,
  cts: icon_ts,
  mts: icon_ts,
  json: icon_json,
  jsonc: icon_json,
  json5: icon_json,
  md: icon_markdown,
  markdown: icon_markdown,
  mdx: icon_markdown,
  lock: icon_lock,
  nix: icon_nix,
  css: icon_css,
  scss: icon_css,
  sass: icon_css,
  less: icon_css,
  styl: icon_css,
  pcss: icon_css,
  postcss: icon_css,
  html: icon_html,
  htm: icon_html,
  vue: icon_vue,
  svelte: icon_html,
  astro: icon_html,
  sh: icon_shell,
  bash: icon_shell,
  zsh: icon_shell,
  fish: icon_shell,
  bat: icon_shell,
  cmd: icon_shell,
  ps1: icon_shell,
  yml: icon_config,
  yaml: icon_config,
  toml: icon_config,
  ini: icon_config,
  cfg: icon_config,
  conf: icon_config,
  properties: icon_properties,
  editorconfig: icon_config,
  java: icon_java,
  class: icon_java,
  jar: icon_java,
  kt: icon_kotlin,
  kts: icon_kotlin,
  py: icon_python,
  pyw: icon_python,
  rs: icon_rust,
  go: icon_go,
  c: icon_c,
  h: icon_c,
  cpp: icon_cpp,
  cc: icon_cpp,
  cxx: icon_cpp,
  hpp: icon_cpp,
  hxx: icon_cpp,
  cs: icon_cs,
  sql: icon_sql,
  xml: icon_xml,
  fxml: icon_xml,
  xsd: icon_xml,
  php: icon_php,
  rb: icon_ruby,
  swift: icon_swift,
  gradle: icon_gradle,
  png: icon_image,
  jpg: icon_image,
  jpeg: icon_image,
  gif: icon_image,
  webp: icon_image,
  ico: icon_image,
  bmp: icon_image,
  svg: icon_image,
  avif: icon_image,
};

const CODE_EXTENSIONS = new Set([
  "py",
  "rs",
  "go",
  "java",
  "rb",
  "php",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cs",
  "swift",
  "kt",
  "scala",
  "sql",
  "graphql",
  "gql",
  "prisma",
  "proto",
  "lua",
  "zig",
  "ex",
  "exs",
  "erl",
  "hs",
  "ml",
  "clj",
  "dart",
  "r",
  "jl",
  "pl",
  "vim",
  "tf",
  "hcl",
  "gradle",
  "cmake",
  "nim",
  "d",
]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "csv",
  "tsv",
  "rtf",
  "pdf",
  "doc",
  "docx",
  "tex",
  "adoc",
  "rst",
  "org",
  "epub",
]);

const CODE_FILE_NAMES = new Set([
  "makefile",
  "dockerfile",
  "jenkinsfile",
  "gemfile",
  "rakefile",
  "procfile",
  "pipfile",
  "gradlew",
]);

const TEXT_FILE_NAMES = new Set(["readme", "license", "licence", "changelog"]);

function getFileTreeFileIcon(fileName: string): string {
  const name = fileName.toLowerCase().replace(/:\d+(-\d+)?$/, "");
  if (name === ".git" || name.startsWith(".git")) {
    return icon_git;
  }
  if (name.endsWith(".lock") || name.endsWith(".lockb") || name.includes("-lock.")) {
    return icon_lock;
  }
  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  const extIcon = EXT_ICONS[ext];
  if (extIcon) {
    return extIcon;
  }
  if (name.startsWith(".eslint") || name.startsWith("eslint.config")) {
    return icon_eslint;
  }
  if (name === "dockerfile" || name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) {
    return icon_docker;
  }
  if (CODE_FILE_NAMES.has(name)) {
    return icon_file_code;
  }
  if (TEXT_FILE_NAMES.has(name)) {
    return icon_file_text;
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return icon_file_code;
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return icon_file_text;
  }
  return icon_file;
}

const folder_code = svg24('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>');
const folder_docs = svg24(
  '<path d="M12 7v14"/>' +
    '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
);
const folder_tests = svg24(
  '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/>' +
    '<path d="M8.5 2h7"/>',
);
const folder_git = svg24(
  '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
);
const folder_hooks = svg24(
  '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0' +
    ' 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
);
const folder_packages = svg24(
  '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/>' +
    '<path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/>',
);
const folder_build = svg24(
  '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
);
const folder_release = svg24(
  '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426' +
    ' 0 0 0 0-3.42z"/>' +
    '<circle cx="7.5" cy="7.5" r=".5"/>',
);
const folder_config = svg24(
  '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/>' +
    '<path d="M8 10v4"/><path d="M16 18v4"/>',
);
const folder_scripts = svg24(
  '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
);
const folder_assets = svg24(
  '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
);
const folder_styles = svg24(
  '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/>' +
    '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0' +
    ' 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
);
const folder_agents = svg24(
  '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
);
const folder_api = svg24(
  '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
);
const folder_cache = svg24(
  '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' +
    '<path d="M6 16h.01"/><path d="M10 16h.01"/>',
);
const folder_client = svg24(
  '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
);
const folder_deploy = svg24(
  '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
);
const folder_components = svg24(
  '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>' +
    '<path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
);
const folder_database = svg24(
  '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
);

const FOLDER_ICONS: Record<string, string> = {
  src: folder_code,
  source: folder_code,
  lib: folder_code,
  docs: folder_docs,
  doc: folder_docs,
  documentation: folder_docs,
  test: folder_tests,
  tests: folder_tests,
  __tests__: folder_tests,
  spec: folder_tests,
  e2e: folder_tests,
  ".git": folder_git,
  ".github": folder_git,
  ".gitlab": folder_git,
  ".githooks": folder_hooks,
  ".husky": folder_hooks,
  hooks: folder_hooks,
  node_modules: folder_packages,
  vendor: folder_packages,
  packages: folder_packages,
  dist: folder_build,
  build: folder_build,
  out: folder_build,
  target: folder_build,
  release: folder_release,
  releases: folder_release,
  ".config": folder_config,
  config: folder_config,
  ".vscode": folder_config,
  ".idea": folder_config,
  scripts: folder_scripts,
  bin: folder_scripts,
  public: folder_assets,
  assets: folder_assets,
  static: folder_assets,
  images: folder_assets,
  img: folder_assets,
  icons: folder_assets,
  styles: folder_styles,
  css: folder_styles,
  theme: folder_styles,
  ".agents": folder_agents,
  agents: folder_agents,
  api: folder_api,
  cache: folder_cache,
  ".cache": folder_cache,
  client: folder_client,
  deployment: folder_deploy,
  deploy: folder_deploy,
  components: folder_components,
  features: folder_components,
  db: folder_database,
  database: folder_database,
  migrations: folder_database,
};

export function getFileTreeIconSvg(
  name: string,
  isFolder: boolean,
  isOpen: boolean = false,
): string {
  if (isFolder) {
    return FOLDER_ICONS[name.toLowerCase()] ?? (isOpen ? icon_folder_open : icon_folder);
  }
  return getFileTreeFileIcon(name);
}
