import Footer from "../../components/Footer";
import FeatureDemo from "./FeatureDemo";
import MainHero from "./MainHero";
import ProductShowcase from "./ProductShowcase";
import FeaturesPreview from "./FeaturesPreview";
import BlogPreview from "./BlogPreview";
import Changelog from "./Changelog";
import EndingOutro from "./EndingOutro";
import ScrollStackSection from "./ScrollStackSection";

export default function Home() {
  return (
    <div className="mx-auto max-w-[1420px] px-5 pt-24 sm:px-8 md:px-12 md:pt-28 lg:px-20">
      <div className="relative z-0">
        <section>
          <MainHero/>
        </section>
        <section
          className="sticky top-16 z-0 mt-6 overflow-hidden bg-background"
          data-scroll-stack-anchor
        >
          <FeatureDemo/>
        </section>
        <div className="h-[30svh]" aria-hidden="true" data-scroll-stack-spacer />
      </div>

      <section
        className="relative z-10 -mt-10 rounded-t-[2rem] border-t border-border bg-background pt-8 shadow-[0_-24px_60px_-36px_color-mix(in_oklab,var(--foreground)_24%,transparent)] md:pt-12"
        data-scroll-stage
      >
        <ProductShowcase/>
      </section>

      <ScrollStackSection layer={20}>
        <FeaturesPreview/>
      </ScrollStackSection>

      <ScrollStackSection layer={30}>
        <BlogPreview/>
      </ScrollStackSection>

      <ScrollStackSection layer={40}>
        <Changelog/>
      </ScrollStackSection>

      <ScrollStackSection layer={50}>
        <EndingOutro/>
      </ScrollStackSection>

      <section className="relative z-[60] bg-background pt-8">
        <Footer />
      </section>
      
    </div>
  );
}
