import { AcornCursor } from "./landing/acorn-cursor";
import { Facts } from "./landing/facts";
import { Faq } from "./landing/faq";
import { Features } from "./landing/features";
import { FinalCta } from "./landing/final-cta";
import { Hero } from "./landing/hero";
import { LANDING_FONT_CLASSES } from "./landing/landing-fonts";
import { LandingFooter } from "./landing/landing-footer";
import { LandingNav } from "./landing/nav";
import { Pricing } from "./landing/pricing";
import { Steps } from "./landing/steps";
import "./landing/landing.css";

/** The signed-out home page, top to bottom. It has its own look and does not use the app theme. */
export function LandingPage({
  installHref,
  downloadUrl,
}: {
  installHref: string;
  downloadUrl: string | null;
}) {
  return (
    <div className={`ac ${LANDING_FONT_CLASSES}`}>
      <div className="ac-bg" />
      <div className="ac-bg-grid" />
      <LandingNav installHref={installHref} />
      <main className="ac-container">
        <Hero installHref={installHref} />
        <Facts />
        <Steps />
        <Features />
        <Pricing />
        <Faq />
        <FinalCta installHref={installHref} downloadUrl={downloadUrl} />
      </main>
      <LandingFooter />
      <AcornCursor />
    </div>
  );
}
