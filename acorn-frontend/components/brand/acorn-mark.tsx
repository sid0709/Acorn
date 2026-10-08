/**
 * The Acorn "A": one ribbon that rises to a rounded peak, turns at the right
 * foot, and waves back as the crossbar toward the curled left foot.
 * `app/icon.svg` draws the same path for the favicon.
 */
export const ACORN_MARK_PATH =
  "M36 77 C27 79 14 82 10 77 C6 72 10 66 15 60 C25 48 33 34 40 24 C45 16 55 16 60 24 C67 34 75 48 85 60 C90 66 94 76 87 79 C79 82 70 70 62 63 C55 57 46 59 37 66";

const VIEW_BOX = "0 0 100 100";
/** Ribbon width in viewBox units. The neon core sits inside the rim. */
const RIBBON_WIDTH = 10;
const NEON_CORE_WIDTH = 6.5;

export type AcornMarkVariant = "solid" | "neon";

/**
 * Solid for small sizes (the nav, the favicon). Neon is the glowing tube from
 * the brand art, for the hero. Size comes from the `size` class modifier.
 */
export function AcornMark({
  variant = "solid",
  size = "md",
  label = "",
}: {
  variant?: AcornMarkVariant;
  size?: "sm" | "md" | "lg" | "xl";
  /** Empty when a visible name sits beside the mark. */
  label?: string;
}) {
  return (
    <svg
      className={`acorn-mark acorn-mark-${size} acorn-mark-${variant}`}
      viewBox={VIEW_BOX}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path className="acorn-mark-rim" d={ACORN_MARK_PATH} strokeWidth={RIBBON_WIDTH} />
      {variant === "neon" ? (
        <path className="acorn-mark-core" d={ACORN_MARK_PATH} strokeWidth={NEON_CORE_WIDTH} />
      ) : null}
    </svg>
  );
}
