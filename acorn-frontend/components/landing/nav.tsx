import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/config";
import { CTA_INSTALL, CTA_START, LANDING_NAV } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { ACORN_ART } from "./acorn-art";

/** The fixed top bar: the logo, the section links, and the two ways in. */
export function LandingNav({ installHref }: { installHref: string }) {
  const { logo } = ACORN_ART;
  return (
    <header className="ac-header">
      <div className="ac-container ac-nav">
        <Link href={ROUTES.home} className="ac-brand" aria-label={BRAND}>
          <Image
            src={logo.src}
            alt=""
            width={logo.width}
            height={logo.height}
            className="ac-brand-logo"
            priority
          />
        </Link>
        <nav className="ac-nav-links" aria-label="Sections">
          {LANDING_NAV.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="ac-nav-link">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ac-nav-actions">
          <a href={installHref} className="ac-btn ac-btn-glass ac-hide-narrow">
            {CTA_INSTALL}
          </a>
          <Link href={ROUTES.signUp} className="ac-btn ac-btn-primary">
            {CTA_START}
          </Link>
        </div>
      </div>
    </header>
  );
}
