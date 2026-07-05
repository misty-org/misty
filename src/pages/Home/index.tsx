import Footer from "../../components/Footer";
import FeatureDemo from "./FeatureDemo";
import MainHero from "./MainHero";
import ServiceProviders from "./FeaturesProviders";
import ProductScrollShowcase from "./ProductScrollShowcase";
import Docs from "./DocsSection";
import BlogPreview from "./BlogPreview";
import Changelog from "./Changelog";
import EndingOutro from "./EndingOutro";

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 pt-24 md:pt-28 flex flex-col gap-20">
      <div className="flex flex-col gap-6">
        <section>
          <MainHero/>
        </section>
        <section>
          <FeatureDemo/>
        </section>
      </div>

      <section>
        <ServiceProviders/>
      </section>

      <section>
        <ProductScrollShowcase/>
      </section>

      <section>
        <Docs/>
      </section>

      <section>
        <BlogPreview/>
      </section>

      <section>
        <Changelog/>
      </section>

      <section>
        <EndingOutro/>
      </section>

      <section>
        <Footer />
      </section>
      
    </div>
  );
}
