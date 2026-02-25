import { ParticleField } from "../../components/ParticleField";
import Footer from "../../components/Footer";
import FeatureDemo from "./FeatureDemo";
import MainHero from "./MainHero";
import ServiceProviders from "./FeaturesProviders";
import FeaturesShowcase from "./FeaturesShowcase";
import Documentation from "./Documentation";
import Changelog from "./Changelog";
import EndingOutro from "./EndingOutro";

export default function Home() {
  return (
    <div className="max-w-280 mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-30">
      <div className="fixed inset-0 w-full h-full -z-50 pointer-events-none">
        <ParticleField/>
      </div>
     
      <section>
        <MainHero/>
      </section>
      
      <section>
        <FeatureDemo/>
      </section>

      <section>
        <ServiceProviders/>
      </section>

      <section>
        <FeaturesShowcase/>
      </section>

      <section>
        <Documentation/>
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
