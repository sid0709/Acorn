import { Facts } from "./landing/facts";
import { Faq } from "./landing/faq";
import { Features } from "./landing/features";
import { FinalCta } from "./landing/final-cta";
import { Hero } from "./landing/hero";
import { LandingShell } from "./landing/landing-shell";
import { Pricing } from "./landing/pricing";
import { Steps } from "./landing/steps";

/** The signed-out home page, top to bottom. */
export function LandingPage({
  installHref,
  downloadUrl,
}: {
  installHref: string;
  downloadUrl: string | null;
}) {
  return (
    <LandingShell installHref={installHref} hasCursor>
      <Hero installHref={installHref} />
      <Facts />
      <Steps />
      <Features />
      <Pricing />
      <Faq />
      <FinalCta installHref={installHref} downloadUrl={downloadUrl} />
    </LandingShell>
  );
}
