import Image from "next/image";
import Link from "next/link";
import { CTA_INSTALL, CTA_START, HERO_LEDE, POSITIONING, SLOGAN_LEAD } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { ACORN_ART } from "./acorn-art";
import { AgentSimulator } from "./agent-simulator";
import { SloganPayoff } from "./slogan-payoff";

/** The first screen: the glossy acorn, the slogan as the page's h1, the ways in, and the agent at work. */
export function Hero({ installHref }: { installHref: string }) {
  const { acorn } = ACORN_ART;
  return (
    <section className="ac-hero" aria-labelledby="hero-title">
      <span className="ac-hero-acorn">
        <Image
          src={acorn.src}
          alt=""
          width={acorn.width}
          height={acorn.height}
          className="ac-hero-acorn-art"
          priority
        />
      </span>
      <div className="ac-badge" data-hover>
        <span className="ac-dot" />
        {POSITIONING}
      </div>
      <h1 id="hero-title">
        {SLOGAN_LEAD} <br />
        <span className="ac-gradient-text">
          <SloganPayoff />
        </span>
      </h1>
      <p className="ac-hero-sub">{HERO_LEDE}</p>
      <div className="ac-hero-cta">
        <Link href={ROUTES.signUp} className="ac-btn ac-btn-primary">
          {CTA_START}
        </Link>
        <a href={installHref} className="ac-btn ac-btn-glass">
          {CTA_INSTALL}
        </a>
      </div>
      <AgentSimulator />
    </section>
  );
}
