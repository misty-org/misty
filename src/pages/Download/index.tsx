import { useState } from "react";
import { SiAndroid, SiAppstore, SiLinux } from "react-icons/si";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiBase } from "../../lib/apiBase";
import {
  mobileBuilds,
  releases,
  type MobileBuild,
  type MobilePlatformName,
  type PlatformName,
  type ReleaseBuild,
} from "./data";

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
    icon: <SiLinux className="h-4 w-4" aria-hidden="true" />,
    arch: "x86_64 / ARM64",
  },
};

const mobilePlatformMeta: Record<MobilePlatformName, { icon: React.ReactNode; arch: string }> = {
  iOS: {
    icon: <SiAppstore className="h-4 w-4" aria-hidden="true" />,
    arch: "iPhone / iPad",
  },
  Android: {
    icon: <SiAndroid className="h-4 w-4" aria-hidden="true" />,
    arch: "Android phones",
  },
};

function BuildCard({
  icon,
  platform,
  tag,
  arch,
  children,
}: {
  icon: React.ReactNode;
  platform: string;
  tag: string;
  arch: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm" className="gap-0 rounded-xl py-0">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="text-muted-foreground">{icon}</span>
            {platform}
          </div>
          <Badge variant="outline" className="text-[11px]">
            {tag}
          </Badge>
        </div>
        <p className="mb-1 text-xs text-muted-foreground">{arch}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function ReleaseItem({
  version,
  builds,
  mobileBuilds,
  isLatest,
  pendingBuildKey,
  onDownload,
}: {
  version: string;
  builds: ReleaseBuild[];
  mobileBuilds?: MobileBuild[];
  isLatest: boolean;
  pendingBuildKey: string | null;
  onDownload: (build: ReleaseBuild) => void;
}) {
  return (
    <AccordionItem value={version}>
      <AccordionTrigger className="py-4 text-foreground hover:no-underline">
        <span>
          {version}
          {isLatest ? " (latest)" : ""}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-5 pb-4">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {builds.map((build) => (
              <BuildCard
                key={`${version}-${build.platform}-${build.tag}`}
                icon={platformMeta[build.platform].icon}
                platform={build.platform}
                tag={build.tag}
                arch={platformMeta[build.platform].arch}
              >
                <Button
                  type="button"
                  onClick={() => onDownload(build)}
                  disabled={pendingBuildKey === `${version}-${build.platformKey}`}
                  className="h-auto w-full rounded-xl px-4 py-2.5"
                >
                  {pendingBuildKey === `${version}-${build.platformKey}`
                    ? "Preparing..."
                    : "Download"}
                </Button>
              </BuildCard>
            ))}
          </div>

          {mobileBuilds && mobileBuilds.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mobileBuilds.map((build) => (
                <BuildCard
                  key={`${version}-${build.platform}-${build.tag}`}
                  icon={mobilePlatformMeta[build.platform].icon}
                  platform={build.platform}
                  tag={build.tag}
                  arch={mobilePlatformMeta[build.platform].arch}
                >
                  {build.href ? (
                    <Button asChild className="h-auto w-full rounded-xl px-4 py-2.5">
                      <a href={build.href} target="_blank" rel="noopener noreferrer">
                        {build.ctaLabel}
                      </a>
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled
                      className="h-auto w-full rounded-xl px-4 py-2.5"
                    >
                      {build.ctaLabel}
                    </Button>
                  )}
                </BuildCard>
              ))}
            </div>
          ) : null}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export default function Download() {
  const [openVersions, setOpenVersions] = useState<Record<string, boolean>>(
    Object.fromEntries(
      releases.map((release, index) => [release.version, index === 0]),
    ),
  );
  const [pendingBuildKey, setPendingBuildKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function requestDownload(build: ReleaseBuild, version: string) {
    const buildKey = `${version}-${build.platformKey}`;
    setPendingBuildKey(buildKey);
    setDownloadError(null);

    try {
      const response = await fetch(
        `${apiBase}/download-url?platform=${encodeURIComponent(build.platformKey)}`,
        { credentials: "include" },
      );

      const contentType = response.headers.get("Content-Type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const message =
          typeof payload === "string"
            ? payload.trim()
            : typeof payload?.message === "string"
              ? payload.message
              : "Unable to prepare this download.";
        throw Object.assign(new Error(message || "Unable to prepare this download."), {
          status: response.status,
        });
      }

      if (typeof payload?.url !== "string") {
        throw new Error("The download server returned an invalid URL.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : 0;

      if (status === 401) {
        window.location.assign("/signin");
        return;
      }

      setDownloadError(error instanceof Error ? error.message : "Unable to prepare this download.");
    } finally {
      setPendingBuildKey(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      {/* Header */}
      <div className="text-center">
        <h1 className="mb-5 text-balance text-3xl font-bold text-foreground md:text-5xl">
          Download
        </h1>
      </div>

      {/* Releases */}
      <div className="mb-20">
        <h2 className="text-lg font-semibold text-foreground">Releases</h2>
        {downloadError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{downloadError}</AlertDescription>
          </Alert>
        )}
        <Accordion
          type="multiple"
          value={releases
            .filter((release) => openVersions[release.version])
            .map((release) => release.version)}
          onValueChange={(versions) => {
            setOpenVersions(
              Object.fromEntries(
                releases.map((release) => [
                  release.version,
                  versions.includes(release.version),
                ]),
              ),
            );
          }}
        >
          {releases.map((release) => (
            <ReleaseItem
              key={release.version}
              version={release.version}
              builds={release.builds}
              mobileBuilds={release.version === releases[0].version ? mobileBuilds : undefined}
              isLatest={release.version === releases[0].version}
              pendingBuildKey={pendingBuildKey}
              onDownload={(build) => requestDownload(build, release.version)}
            />
          ))}
        </Accordion>
      </div>
    </div>
  );
}
