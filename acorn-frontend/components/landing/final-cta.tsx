import Link from "next/link";
import { CTA_INSTALL, CTA_START, SLOGAN_LEAD } from "@/lib/landing";
import { INSTALL_SECTION_ID, ROUTES } from "@/lib/routes";
import { SloganPayoff } from "./slogan-payoff";

/** The closing call to action, and the in-page install target when there is no store listing. */
export function FinalCta({
  installHref,
  downloadUrl,
}: {
  installHref: string;
  downloadUrl: string | null;
}) {
  return (
    <section
      id={INSTALL_SECTION_ID}
      className="ac-cta"
      aria-labelledby={`${INSTALL_SECTION_ID}-title`}
    >
      <h2 id={`${INSTALL_SECTION_ID}-title`}>
        {SLOGAN_LEAD} <SloganPayoff />
      </h2>
      <p>
        Create a free account, add the extension, and let the auto-bid agent send your next
        application while you prepare for the interview.
      </p>
      <div className="ac-hero-cta">
        <Link href={ROUTES.signUp} className="ac-btn ac-btn-primary ac-btn-lg">
          {CTA_START}
        </Link>
        <a href={downloadUrl ?? installHref} className="ac-btn ac-btn-glass ac-btn-lg">
          {downloadUrl ? "Download for Chrome" : CTA_INSTALL}
        </a>
      </div>
      <p className="ac-cta-note">
        Sign in on this site in the same browser, then open the Acorn side panel and choose
        Continue.
      </p>
    </section>
  );
}
