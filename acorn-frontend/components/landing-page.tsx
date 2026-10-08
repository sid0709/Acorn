import { AgentBand } from "./landing/agent-band";
import { AgentFlow } from "./landing/agent-flow";
import { AtsResume } from "./landing/ats-resume";
import { Compare } from "./landing/compare";
import { Faq } from "./landing/faq";
import { FeatureGrid } from "./landing/feature-grid";
import { FinalCta } from "./landing/final-cta";
import { Hero } from "./landing/hero";
import { LandingFooter } from "./landing/landing-footer";
import { LandingNav } from "./landing/landing-nav";
import { Pricing } from "./landing/pricing";
import { ProductPreview } from "./landing/product-preview";
import { Topics } from "./landing/topics";
import { TrustStrip } from "./landing/trust-strip";
import { UseCases } from "./landing/use-cases";
import "./landing/landing.css";

/** The signed-out home page, top to bottom. */
export function LandingPage({
  installHref,
  downloadUrl,
}: {
  installHref: string;
  downloadUrl: string | null;
}) {
  return (
    <div className="lp">
      <div className="lp-nav">
        <LandingNav />
      </div>
      <main className="lp-main">
        <Hero installHref={installHref} />
        <TrustStrip />
        <AgentFlow />
        <ProductPreview />
        <FeatureGrid />
        <AgentBand />
        <Compare />
        <AtsResume />
        <UseCases />
        <Pricing />
        <Topics />
        <Faq />
        <FinalCta installHref={installHref} downloadUrl={downloadUrl} />
      </main>
      <LandingFooter />
    </div>
  );
}
