export const FOLDER_PREVIEW_LIMIT = 80;

export const FILE_METADATA_LOAD_DELAY_MS = 180;

export const FILE_PREVIEW_LOAD_DELAY_MS = 0;

export const INSPECTOR_IMAGE_PREVIEW_MAX_DIMENSION = 384;

export const textPreviewExtensions = new Set([
  "txt",
  "text",
  "log",
  "md",
  "markdown",
  "toml",
  "yaml",
  "yml",
  "ini",
  "conf",
  "cfg",
  "csv",
  "tsv",
  "rs",
  "go",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "html",
  "xml",
  "sh",
  "zsh",
  "bash",
  "fish",
  "py",
  "rb",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "swift",
  "kt",
  "sql",
  "json",
  "jsonc",
]);

export const browserImageMimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
};

export const browserVideoMimeTypes: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
};

export const browserAudioMimeTypes: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

export const archivePreviewExtensions = new Set([
  "zip",
  "tar",
  "tgz",
  "tar.gz",
  "tbz",
  "tbz2",
  "tar.bz2",
  "txz",
  "tar.xz",
  "7z",
  "rar",
]);

export const nativeImageThumbnailExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tga",
  "hdr",
  "pic",
  "pbm",
  "pgm",
  "pnm",
  "ppm",
  "psd",
]);
