import { NavLink } from "react-router";
import { featureChapters } from "../Features/featureData";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export default function FeaturesPreview() {
  return (
    <div>
      <div className="mb-8 flex items-center justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Features</h2>
        <NavLink
          to="/features"
          className="group flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Browse all features
          <span className="transition-transform duration-300 group-hover:translate-x-1">&rarr;</span>
        </NavLink>
      </div>

      <Card className="grid gap-0 overflow-hidden py-0 md:grid-cols-3">
        {featureChapters.map((chapter, index) => (
          <section
            key={chapter.id}
            className={`p-6 md:p-7 ${index > 0 ? "border-t border-border/70 md:border-l md:border-t-0" : ""}`}
          >
            <h3 className="text-xl font-semibold tracking-tight text-foreground">{chapter.title}</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {chapter.features.map((feature) => (
                <Badge
                  key={feature.title}
                  variant="outline"
                  className="h-auto px-3 py-1.5 text-xs font-normal text-muted-foreground"
                >
                  {feature.title}
                </Badge>
              ))}
            </div>
          </section>
        ))}
      </Card>
    </div>
  );
}
