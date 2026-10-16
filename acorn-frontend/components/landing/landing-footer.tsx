import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/config";
import { LANDING_NAV, POSITIONING } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { ACORN_ART } from "./acorn-art";

/** Sign-in lives here, small: the top bar only offers the two ways in. */
const LINKS = [
  { label: "Privacy Policy", href: ROUTES.privacy },
  { label: "Terms of Service", href: ROUTES.terms },
  { label: "Sign in", href: ROUTES.signIn },
] as const;

export function LandingFooter() {
  const { text } = ACORN_ART;
  return (
    <footer className="ac-footer">
      <Image
        src={text.src}
        alt={BRAND}
        width={text.width}
        height={text.height}
        className="ac-footer-logo"
      />
      <p className="ac-footer-line">{POSITIONING}.</p>
      <nav className="ac-footer-links" aria-label="Footer">
        {LANDING_NAV.map((item) => (
          <a key={item.id} href={`#${item.id}`}>
            {item.label}
          </a>
        ))}
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <p>
        © {new Date().getFullYear()} {BRAND}. All rights reserved.
      </p>
    </footer>
  );
}
