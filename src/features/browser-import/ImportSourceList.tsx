import { FileUp } from "lucide-react";
import { Button, Skeleton, cn } from "@/shared/ui";
import { BrowserLogo } from "./BrowserLogo";
import type { ImportSource, ImportSourceRequest } from "./native";

export interface ChosenSource extends ImportSourceRequest {
  name: string;
  profileName?: string;
}

/** Each button eases in a beat after the one before it. */
export const enter =
  "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 fill-mode-both motion-reduce:animate-none";

export function chosenProfile(source: ImportSource, profileId: string): ChosenSource {
  const profile = source.profiles.find((p) => p.id === profileId) ?? source.profiles[0];
  return {
    browser: source.browser,
    profile: profile.id,
    name: source.name,
    profileName: source.profiles.length > 1 ? profile.name : undefined,
  };
}

/**
 * One button per browser found on this computer, the one used most recently
 * first and emphasized. A browser with several profiles starts with its most
 * recently used one; the next step can switch.
 */
export function ImportSourceList(props: {
  sources: ImportSource[] | null;
  onChoose(source: ChosenSource): void;
  onFile(): void;
}) {
  if (!props.sources)
    return (
      <div role="status" aria-label="Finding your browsers" className="grid gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  return (
    <div className="grid gap-2">
      {props.sources.map((source, index) => (
        <Button
          key={source.browser}
          size="lg"
          justify="start"
          variant={index === 0 ? "primary" : "outline"}
          className={cn("w-full gap-3", enter)}
          style={{ animationDelay: `${index * 60}ms` }}
          onClick={() => props.onChoose(chosenProfile(source, source.profiles[0].id))}
        >
          <BrowserLogo browser={source.browser} size={20} />
          <span className="truncate">Import from {source.name}</span>
        </Button>
      ))}
      <Button
        variant="ghost"
        justify="start"
        className={cn("w-full gap-3 text-cream-muted", enter)}
        style={{ animationDelay: `${props.sources.length * 60}ms` }}
        onClick={props.onFile}
      >
        <FileUp size={16} aria-hidden />
        Import a bookmarks file instead
      </Button>
    </div>
  );
}
