import { useState } from "react";
import { FaApple, FaWindows } from "react-icons/fa";
import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { JOIN_HREF } from "@/lib/site";
import {
  currentRelease,
  type PlatformName,
  type ReleaseBuild,
} from "@/pages/Download/data";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

function detectDownloadPlatform(): PlatformName | undefined {
  if (typeof navigator === "undefined") return undefined;

  try {
    const detectedNavigator = navigator as NavigatorWithUserAgentData;
    const userAgent = detectedNavigator.userAgent;
    const isMobile =
      /Android|iPhone|iPad|iPod/i.test(userAgent) ||
      (detectedNavigator.platform === "MacIntel" &&
        detectedNavigator.maxTouchPoints > 1);

    if (isMobile) return undefined;

    const platform = [
      detectedNavigator.userAgentData?.platform,
      detectedNavigator.platform,
      userAgent,
    ]
      .filter(Boolean)
      .join(" ");

    if (/Mac/i.test(platform)) return "macOS";
    if (/Win/i.test(platform)) return "Windows";
  } catch {
    return undefined;
  }

  return undefined;
}

function detectDownloadBuild(): ReleaseBuild | undefined {
  const platform = detectDownloadPlatform();
  return currentRelease.builds.find((build) => build.platform === platform);
}

export function HomeCtaButtons({
  className,
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  const [downloadBuild] = useState(detectDownloadBuild);

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button
        asChild
        size="lg"
        className={cn(
          "h-11 rounded-full px-6 text-sm hover:opacity-85",
          dark
            ? "bg-white text-[#09090b] hover:bg-white"
            : "bg-[var(--marketing-foreground)] text-[var(--marketing-surface)]",
        )}
      >
        {downloadBuild ? (
          <a
            href={downloadBuild.href}
            aria-label={`Download Misty for ${downloadBuild.platform}`}
          >
            {downloadBuild.platform === "macOS" ? (
              <FaApple className="-translate-y-px" aria-hidden="true" />
            ) : (
              <FaWindows className="-translate-y-px" aria-hidden="true" />
            )}
            <span>Download for {downloadBuild.platform}</span>
          </a>
        ) : (
          <NavLink to={JOIN_HREF}>Get started</NavLink>
        )}
      </Button>
      <Button
        asChild
        variant="outline"
        size="lg"
        className={cn(
          "h-11 rounded-full bg-transparent px-6 text-sm",
          dark
            ? "border-white/30 text-white hover:bg-white/10 hover:text-white"
            : "border-[var(--marketing-border-strong)] text-[var(--marketing-foreground)] hover:bg-[var(--secondary)]",
        )}
      >
        <NavLink to={JOIN_HREF}>Join now</NavLink>
      </Button>
    </div>
  );
}
