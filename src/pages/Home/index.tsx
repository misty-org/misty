import Footer from "../../components/Footer";
import FeatureDemo from "./FeatureDemo";
import MainHero from "./MainHero";
import ProductScrollShowcase from "./ProductScrollShowcase";
import FeaturesPreview from "./FeaturesPreview";
import BlogPreview from "./BlogPreview";
import Changelog from "./Changelog";
import EndingOutro from "./EndingOutro";

export default function Home() {
  return (
    <div className="mx-auto flex max-w-[1420px] flex-col gap-20 px-5 pt-24 sm:px-8 md:px-12 md:pt-28 lg:px-20">
      <div className="flex flex-col gap-6">
        <section>
          <MainHero/>
        </section>
        <section>
          <FeatureDemo/>
        </section>
      </div>

      <section className="-mb-[calc(15vh+5rem)]">
        <ProductScrollShowcase/>
      </section>

      <section data-showcase-next>
        <FeaturesPreview/>
      </section>

      <section data-blog-preview>
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
