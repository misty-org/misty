import type { OfficialApp } from "@/api/apps";
import journalImage from "@/assets/discover/journal.png";
import { OfficialAppIcon } from "@/features/apps/OfficialAppIcon";
import { ArrowUpRight } from "lucide-react";

const previews = [
  {
    id: "journal",
    image: journalImage,
    description: "Notes and drawings in one place.",
    alt: "Journal’s drawing canvas and editing toolbar",
  },
] as const;

export function DiscoverAppPreviews({
  apps,
  onSelect,
}: {
  apps: OfficialApp[];
  onSelect: (app: OfficialApp) => void;
}) {
  const available = previews.flatMap((preview) => {
    const app = apps.find((item) => item.id === preview.id && item.official);
    return app ? [{ ...preview, app }] : [];
  });
  if (!available.length) return null;
  return (
    <section className="discover-previews" aria-label="App previews">
      {available.map(({ app, image, description, alt }) => (
        <button
          key={app.id}
          type="button"
          className="discover-preview"
          aria-label={`Preview ${app.name}`}
          onClick={() => onSelect(app)}
        >
          <div className={`discover-preview-image discover-preview-image-${app.id}`}>
            <img
              src={image}
              alt={alt}
              width={app.id === "journal" ? 1200 : 1600}
              height={app.id === "journal" ? 850 : 1000}
              decoding="async"
            />
          </div>
          <span className="discover-preview-caption">
            <OfficialAppIcon appId={app.id} size={28} />
            <span>
              <strong>{app.name}</strong>
              <span>{description}</span>
            </span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </span>
        </button>
      ))}
    </section>
  );
}
