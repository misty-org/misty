import { NavLink } from "react-router";
import { featureChapters } from "../Features/featureData";

export default function FeaturesPreview() {
  return (
    <div>
      <div className="mb-8 flex items-center justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight text-text md:text-4xl">Features</h2>
        <NavLink
          to="/features"
          className="group flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
        >
          Browse all features
          <span className="transition-transform duration-300 group-hover:translate-x-1">&rarr;</span>
        </NavLink>
      </div>

      <div className="glass-card grid overflow-hidden rounded-2xl md:grid-cols-3">
        {featureChapters.map((chapter, index) => (
          <section
            key={chapter.id}
            className={`p-6 md:p-7 ${index > 0 ? "border-t border-border/70 md:border-l md:border-t-0" : ""}`}
          >
            <h3 className="text-xl font-semibold tracking-tight text-text">{chapter.title}</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {chapter.features.map((feature) => (
                <span
                  key={feature.title}
                  className="rounded-full border border-white/10 bg-white/[0.025] px-3 py-1.5 text-xs text-text-muted"
                >
                  {feature.title}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
