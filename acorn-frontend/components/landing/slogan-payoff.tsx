import { AcornWordmark } from "@/components/brand/acorn-wordmark";
import { SLOGAN_PAYOFF_LEAD } from "@/lib/landing";

/** "Now you have Acorn." with the wordmark, so the A is the mark. Reads as plain text. */
export function SloganPayoff() {
  return (
    <>
      {SLOGAN_PAYOFF_LEAD} <AcornWordmark tone="inherit" />.
    </>
  );
}
