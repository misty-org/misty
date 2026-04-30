import { useState } from "react";
import { HiOutlineChevronDown } from "react-icons/hi2";

type PlatformName = "Windows" | "macOS" | "Linux";

type PlatformIconProps = {
  size?: number | string;
  color?: string;
  background?: string;
  opacity?: number;
  rotation?: number;
  shadow?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
};

function iconStyle({
  background,
  opacity,
  rotation,
  shadow,
  flipHorizontal,
  flipVertical,
}: Omit<PlatformIconProps, "size" | "color">) {
  const transforms = [];
  if (rotation) transforms.push(`rotate(${rotation}deg)`);
  if (flipHorizontal) transforms.push("scaleX(-1)");
  if (flipVertical) transforms.push("scaleY(-1)");

  return {
    opacity,
    transform: transforms.join(" ") || undefined,
    filter: shadow ? `drop-shadow(0 ${shadow}px ${shadow * 2}px rgba(0,0,0,0.3))` : undefined,
    backgroundColor: background && background !== "transparent" ? background : undefined,
  };
}

function Windows11Icon({
  size = 32,
  color = "currentColor",
  background = "transparent",
  opacity = 1,
  rotation = 0,
  shadow = 0,
  flipHorizontal = false,
  flipVertical = false,
}: PlatformIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      style={iconStyle({ background, opacity, rotation, shadow, flipHorizontal, flipVertical })}
    >
      <path fill={color} d="M67.328 67.331h60.669V128H67.328zm-67.325 0h60.669V128H.003zM67.328 0h60.669v60.669H67.328zM.003 0h60.669v60.669H.003z" />
    </svg>
  );
}

function AppleIcon({
  size = 32,
  color = "currentColor",
  background = "transparent",
  opacity = 1,
  rotation = 0,
  shadow = 0,
  flipHorizontal = false,
  flipVertical = false,
}: PlatformIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-12 -8 280 321"
      width={size}
      height={size}
      fill={color}
      aria-hidden="true"
      style={{
        ...iconStyle({ background, opacity, rotation, shadow, flipHorizontal, flipVertical }),
        display: "block",
        overflow: "visible",
      }}
    >
      <path d="M213.803 167.03c.442 47.58 41.74 63.413 42.197 63.615c-.35 1.116-6.599 22.563-21.757 44.716c-13.104 19.153-26.705 38.235-48.13 38.63c-21.05.388-27.82-12.483-51.888-12.483c-24.061 0-31.582 12.088-51.51 12.871c-20.68.783-36.428-20.71-49.64-39.793c-27-39.033-47.633-110.3-19.928-158.406c13.763-23.89 38.36-39.017 65.056-39.405c20.307-.387 39.475 13.662 51.889 13.662c12.406 0 35.699-16.895 60.186-14.414c10.25.427 39.026 4.14 57.503 31.186c-1.49.923-34.335 20.044-33.978 59.822M174.24 50.199c10.98-13.29 18.369-31.79 16.353-50.199c-15.826.636-34.962 10.546-46.314 23.828c-10.173 11.763-19.082 30.589-16.678 48.633c17.64 1.365 35.66-8.964 46.64-22.262" />
    </svg>
  );
}

function LinuxIcon({
  size = 32,
  color = "currentColor",
  background = "transparent",
  opacity = 1,
  rotation = 0,
  shadow = 0,
  flipHorizontal = false,
  flipVertical = false,
}: PlatformIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      style={iconStyle({ background, opacity, rotation, shadow, flipHorizontal, flipVertical })}
    >
      <path fill={color} d="M12.504 0q-.232 0-.48.021c-4.226.333-3.105 4.807-3.17 6.298c-.076 1.092-.3 1.953-1.05 3.02c-.885 1.051-2.127 2.75-2.716 4.521c-.278.832-.41 1.684-.287 2.489a.4.4 0 0 0-.11.135c-.26.268-.45.6-.663.839c-.199.199-.485.267-.797.4c-.313.136-.658.269-.864.68c-.09.189-.136.394-.132.602c0 .199.027.4.055.536c.058.399.116.728.04.97c-.249.68-.28 1.145-.106 1.484c.174.334.535.47.94.601c.81.2 1.91.135 2.774.6c.926.466 1.866.67 2.616.47c.526-.116.97-.464 1.208-.946c.587-.003 1.23-.269 2.26-.334c.699-.058 1.574.267 2.577.2c.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071s1.592-.536 2.257-1.306c.631-.765 1.683-1.084 2.378-1.503c.348-.199.629-.469.649-.853c.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926c-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.36.36 0 0 0-.19-.064c.431-1.278.264-2.55-.173-3.694c-.533-1.41-1.465-2.638-2.175-3.483c-.796-1.005-1.576-1.957-1.56-3.368c.026-2.152.236-6.133-3.544-6.139m.529 3.405h.013c.213 0 .396.062.584.198c.19.135.33.332.438.533c.105.259.158.459.166.724c0-.02.006-.04.006-.06v.105l-.004-.021l-.004-.024a1.8 1.8 0 0 1-.15.706a.95.95 0 0 1-.213.335a1 1 0 0 0-.088-.042c-.104-.045-.198-.064-.284-.133a1.3 1.3 0 0 0-.22-.066c.05-.06.146-.133.183-.198q.08-.193.088-.402v-.02a1.2 1.2 0 0 0-.061-.4c-.045-.134-.101-.2-.183-.333c-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 0 0-.205.334a1.2 1.2 0 0 0-.09.4v.019q.002.134.02.267c-.193-.067-.438-.135-.607-.202a2 2 0 0 1-.018-.2v-.02a1.8 1.8 0 0 1 .15-.768a1.08 1.08 0 0 1 .43-.533a1 1 0 0 1 .594-.2zm-2.962.059h.036c.142 0 .27.048.399.135c.146.129.264.288.344.465c.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024c-.152.055-.274.135-.393.2q.018-.136.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.6.6 0 0 0-.166-.267a.25.25 0 0 0-.183-.064h-.021c-.071.006-.13.04-.186.132a.55.55 0 0 0-.12.27a1 1 0 0 0-.023.33v.015c.012.135.037.2.08.334c.046.134.098.2.166.268q.014.014.034.024c-.07.057-.117.07-.176.136a.3.3 0 0 1-.131.068a2.6 2.6 0 0 1-.275-.402a1.8 1.8 0 0 1-.155-.667a1.8 1.8 0 0 1 .08-.668a1.4 1.4 0 0 1 .283-.535c.128-.133.26-.2.418-.2m1.37 1.706c.332 0 .733.065 1.216.399c.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.57.57 0 0 1 .016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465c-.276.135-.588.292-1.012.267a1.1 1.1 0 0 1-.448-.067a4 4 0 0 1-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71q-.104-.403.193-.6c.224-.135.38-.271.483-.336c.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601c.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473c.286.534.855 1.659 1.102 3.024c.156-.005.33.018.513.064c.646-1.671-.546-3.467-1.089-3.966c-.22-.2-.232-.335-.123-.335c.59.534 1.365 1.572 1.646 2.757c.13.535.16 1.104.021 1.67c.067.028.135.06.205.067c1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224c-.915-.4-1.646-.336-1.77.465c-.008.043-.013.066-.018.135c-.068.023-.139.053-.209.064c-.43.268-.662.669-.793 1.187c-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35c-1.5 1.072-3.58 1.538-5.348.334a2.7 2.7 0 0 0-.402-.533a1.5 1.5 0 0 0-.275-.333c.182 0 .338-.03.465-.067a.62.62 0 0 0 .314-.334c.108-.267 0-.697-.345-1.163s-.931-.995-1.788-1.521c-.63-.4-.986-.87-1.15-1.396c-.165-.534-.143-1.085-.015-1.645c.245-1.07.873-2.11 1.274-2.763c.107-.065.037.135-.408.974c-.396.751-1.14 2.497-.122 3.854a8.1 8.1 0 0 1 .647-2.876c.564-1.278 1.743-3.504 1.836-5.268c.048.036.217.135.289.202c.218.133.38.333.59.465c.21.201.477.335.876.335q.058.005.11.006c.412 0 .73-.134.997-.268c.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377c.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876c.085.4.154.78.409 1.066c.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595c-.63.401-1.746.712-2.457 1.57c-.618.737-1.37 1.14-2.036 1.191c-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69c.176-.668.428-1.344.463-1.897c.037-.714.076-1.335.195-1.814c.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01q.08 0 .157.014c.376.055.706.333 1.023.752l.91 1.664l.003.003c.243.533.754 1.064 1.189 1.637c.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294c-.645.135-1.52.002-2.395-.464c-.968-.536-2.118-.469-2.857-.602q-.553-.1-.723-.4c-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118c-.055-.401-.083-.71.043-.94c.16-.334.396-.4.69-.533c.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838c.19-.201.38-.336.663-.336m7.159-9.074c-.435.201-.945.535-1.488.535c-.542 0-.97-.267-1.28-.466c-.154-.134-.28-.268-.373-.335c-.164-.134-.144-.333-.074-.333c.109.016.129.134.199.2c.096.066.215.2.36.333c.292.2.68.467 1.167.467c.485 0 1.053-.267 1.398-.466c.195-.135.445-.334.648-.467c.156-.136.149-.267.279-.267c.128.016.034.134-.147.332a8 8 0 0 1-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05c.074-.043.18-.027.26.004c.063 0 .16.067.15.135c-.006.049-.085.066-.135.066c-.055 0-.092-.043-.141-.068c-.052-.018-.146-.008-.163-.065m-.551 0c-.02.058-.113.049-.166.066c-.047.025-.086.068-.14.068c-.05 0-.13-.02-.136-.068c-.01-.066.088-.133.15-.133c.08-.031.184-.047.259-.005c.019.009.036.03.03.05v.02h.003z" />
    </svg>
  );
}

const platformMeta: Record<PlatformName, { icon: React.ReactNode; arch: string }> = {
  Windows: {
    icon: <Windows11Icon size={16} />,
    arch: "x86_64",
  },
  macOS: {
    icon: <AppleIcon size={16} color="currentColor" />,
    arch: "Apple Silicon / Intel",
  },
  Linux: {
    icon: <LinuxIcon size={16} color="currentColor" />,
    arch: "x86_64 / ARM64",
  },
};

type ReleaseBuild = {
  platform: PlatformName;
  tag: string;
  href: string;
};

const MACOS_DMG_DOWNLOAD_URL =
  import.meta.env.VITE_MACOS_DMG_URL ||
  "https://github.com/kannachi323/misty/releases/download/v0.1.0/Misty-1.0-arm64.dmg";

const WINDOWS_DOWNLOAD_URL =
  import.meta.env.VITE_WINDOWS_URL ||
  "https://github.com/kannachi323/misty/releases/tag/v0.1.0";

const LINUX_DOWNLOAD_URL =
  import.meta.env.VITE_LINUX_URL ||
  "https://github.com/kannachi323/misty/releases/tag/v0.1.0";

const releases = [
  {
    version: "v0.1.0",
    date: "December 2025",
    builds: [
      { platform: "Windows", tag: "Installer", href: WINDOWS_DOWNLOAD_URL },
      { platform: "macOS", tag: "DMG", href: MACOS_DMG_DOWNLOAD_URL },
      { platform: "Linux", tag: "AppImage", href: LINUX_DOWNLOAD_URL },
    ] satisfies ReleaseBuild[],
    notes: [
      "Initial release with Windows, macOS, and Linux support",
      "Google Drive, OneDrive, and iCloud integration",
      "Unified file browser with search",
      "Secure local-only proxy architecture",
    ],
  },
];

function ReleaseItem({
  version,
  builds,
  notes,
  open,
  onToggle,
  isLatest,
}: {
  version: string;
  builds: ReleaseBuild[];
  notes: string[];
  open: boolean;
  onToggle: () => void;
  isLatest: boolean;
}) {
  return (
    <div className="border-b border-border last:border-none">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-text hover:text-text transition-colors cursor-pointer"
      >
        <span>
          {version}
          {isLatest ? " (latest)" : ""}
        </span>
        <HiOutlineChevronDown
          className={`w-4 h-4 shrink-0 text-text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="pb-4 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {builds.map((build) => (
              <div key={`${version}-${build.platform}-${build.tag}`} className="rounded-xl border border-border bg-surface/50 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-text">
                    <span className="text-text-secondary">{platformMeta[build.platform].icon}</span>
                    {build.platform}
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-text-muted">
                    {build.tag}
                  </span>
                </div>
                <p className="text-xs text-text-muted mb-1">{platformMeta[build.platform].arch}</p>
                <a
                  href={build.href}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors duration-300 hover:bg-zinc-200"
                >
                  Download
                </a>
              </div>
            ))}
          </div>

          <ul className="pl-4 space-y-1.5">
            {notes.map((note) => (
              <li
                key={note}
                className="text-sm text-text-muted leading-relaxed list-disc"
              >
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Download() {
  const [openVersions, setOpenVersions] = useState<Record<string, boolean>>(
    Object.fromEntries(
      releases.map((release, index) => [release.version, index === 0]),
    ),
  );

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl md:text-5xl font-bold text-text mb-5 text-balance">
          Download
        </h1>
      </div>

      {/* Releases */}
      <div className="mb-20">
        <h2 className="text-lg font-semibold text-text">Releases</h2>
        <div>
          {releases.map((release) => (
            <ReleaseItem
              key={release.version}
              version={release.version}
              builds={release.builds}
              notes={release.notes}
              isLatest={release.version === releases[0].version}
              open={openVersions[release.version] ?? false}
              onToggle={() =>
                setOpenVersions((current) => ({
                  ...current,
                  [release.version]: !current[release.version],
                }))
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
