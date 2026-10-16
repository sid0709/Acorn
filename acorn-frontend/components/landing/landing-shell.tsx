import type { ReactNode } from "react";
import { AcornCursor } from "./acorn-cursor";
import { LANDING_FONT_CLASSES } from "./landing-fonts";
import { LandingFooter } from "./landing-footer";
import { LandingNav } from "./nav";
import "./landing.css";

/** The page id the skip link jumps to. */
export const MAIN_ID = "main";

/**
 * The frame every public page shares: the night background, the top bar, the footer, and a skip
 * link. It has its own look and does not use the app theme.
 */
export function LandingShell({
  installHref,
  hasCursor = false,
  children,
}: {
  installHref: string;
  /** The glowing cursor and sparks, for the home page only. */
  hasCursor?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`ac ${LANDING_FONT_CLASSES}`}>
      <a href={`#${MAIN_ID}`} className="ac-skip">
        Skip to content
      </a>
      <div className="ac-bg" />
      <div className="ac-bg-grid" />
      <LandingNav installHref={installHref} />
      <main id={MAIN_ID} className="ac-container">
        {children}
      </main>
      <LandingFooter />
      {hasCursor ? <AcornCursor /> : null}
    </div>
  );
}
