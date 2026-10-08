import { VisuallyHidden } from "sid-ui";
import { BRAND } from "@/lib/config";
import { AcornMark } from "./acorn-mark";

const [INITIAL, REST] = [BRAND.slice(0, 1), BRAND.slice(1)];

/**
 * "Acorn" with the lit mark standing in for the A. The real letter stays in the
 * DOM (visually hidden), so the text reads, copies, and indexes as "Acorn".
 */
export function AcornWordmark({ tone = "brand" }: { tone?: "brand" | "inherit" }) {
  return (
    <span className={`acorn-wordmark acorn-wordmark-${tone}`}>
      <AcornMark size="letter" variant="neon" />
      <VisuallyHidden>{INITIAL}</VisuallyHidden>
      {REST}
    </span>
  );
}
