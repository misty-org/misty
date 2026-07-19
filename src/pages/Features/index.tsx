import Footer from "../../components/Footer";
import FeatureCard from "./FeatureCard";
import { mainFeatures } from "./featureData";

export default function Features() {
  return (
    <div className="mx-auto flex max-w-[1420px] flex-col gap-16 px-5 pt-32 pb-20 sm:px-8 md:px-12 lg:px-20">
      <header className="max-w-3xl">
        <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Resources</p>
        <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-6xl">
          Misty features, all in one place.
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
          Explore the file tools, shared Spaces, and intelligence that turn scattered work into one connected workspace.
        </p>
      </header>

      <section className="grid gap-5 lg:grid-cols-2">
        {mainFeatures.map((feature) => (
          <FeatureCard key={feature.title} feature={feature} />
        ))}
      </section>

      <Footer />
    </div>
  );
}
