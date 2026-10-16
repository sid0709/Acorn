import { VisuallyHidden } from "sid-ui";
import { BRAND } from "@/lib/config";
import { SLOGAN_PAYOFF_LEAD } from "@/lib/landing";
import { CursorA } from "./cursor-a";

const [INITIAL, REST] = [BRAND.slice(0, 1), BRAND.slice(1)];

/** "Now you have Acorn." with the glowing cursor icon as the A. The real letter stays in the text. */
export function SloganPayoff() {
  return (
    <>
      {SLOGAN_PAYOFF_LEAD} <CursorA />
      <VisuallyHidden>{INITIAL}</VisuallyHidden>
      {REST}.
    </>
  );
}
