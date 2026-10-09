/**
 * The Acorn mark: one glowing ribbon that rises to a rounded peak, turns at the
 * right foot, and waves back as the crossbar toward the curled left foot.
 *
 * The outline is traced from the brand art and drawn at 85 percent of its width, so
 * it stands in for the "A" of Acorn (see AcornWordmark). `app/icon.svg` uses the same path.
 */
export const ACORN_MARK_VIEW_BOX = "0 0 96.5 100";

export const ACORN_MARK_PATH = [
  "M44.4 0.3 C46.4 -0.2 48.8 0.1 50.8 0.8 C52.8 1.4 54.8 2.7 56.5 4.2",
  "C58.2 5.7 59.6 7.7 60.8 9.7 C62.1 11.7 63 14.1 64 16.3 C65 18.6 65.8 20.9 66.7 23.2",
  "C67.5 25.5 68.4 27.8 69.3 30.1 C70.2 32.4 71 34.8 71.9 37.1",
  "C72.8 39.3 73.9 41.5 74.9 43.8 C75.9 46 76.7 48.3 77.8 50.5",
  "C78.8 52.7 79.9 54.9 81.2 57 C82.4 59 83.8 61 85.2 62.9 C86.7 64.7 88.4 66.3 89.9 68.1",
  "C91.4 69.9 93.1 71.6 94.2 73.7 C95.2 75.8 96 78.3 96.3 80.8",
  "C96.5 83.2 96.4 85.9 95.7 88.2 C95 90.5 93.7 92.8 92.2 94.4",
  "C90.7 96.1 88.6 97.4 86.7 98.3 C84.7 99.2 82.5 99.7 80.4 99.8",
  "C78.3 99.9 76.1 99.7 74.1 99 C72 98.4 70 97.3 68.2 96.1 C66.3 94.9 64.5 93.4 62.8 91.9",
  "C61.1 90.4 59.4 88.8 57.8 87.2 C56.1 85.5 54.6 83.8 53 82.1",
  "C51.3 80.5 49.8 78.7 48 77.3 C46.2 75.9 44.3 74.6 42.4 73.7",
  "C40.4 72.9 38.1 72.7 36.1 72.3 C34 71.9 30.5 72.5 29.9 71.2",
  "C29.3 69.9 31.2 66.6 32.5 64.6 C33.7 62.7 35.6 61 37.4 59.7",
  "C39.2 58.5 41.3 57.5 43.3 57.1 C45.4 56.7 47.7 56.8 49.7 57.4",
  "C51.8 58 53.7 59.4 55.5 60.7 C57.3 62.1 58.8 63.9 60.4 65.6",
  "C61.9 67.4 63.2 69.4 64.8 71.2 C66.3 73 67.9 74.6 69.6 76.2",
  "C71.2 77.9 72.7 79.7 74.5 81.1 C76.2 82.5 78.2 83.9 80.2 84.5",
  "C82.2 85.1 85.3 85.6 86.6 84.7 C87.8 83.8 88.4 80.5 87.5 79.1",
  "C86.7 77.6 83.6 77.1 81.6 76 C79.7 75 77.7 74 75.8 72.7 C74 71.5 72.2 70.1 70.5 68.5",
  "C68.9 66.9 67.5 64.9 66.2 62.9 C64.9 60.9 63.8 58.7 62.7 56.5",
  "C61.6 54.4 60.6 52.1 59.7 49.9 C58.7 47.6 57.8 45.3 56.9 43",
  "C56 40.8 55.1 38.4 54.2 36.1 C53.3 33.9 52.5 31.5 51.5 29.3",
  "C50.6 27 49.8 23.2 48.5 22.6 C47.3 22 45.4 24.1 44.3 25.7",
  "C43.1 27.4 42.5 30.3 41.6 32.6 C40.7 34.9 39.8 37.2 38.9 39.5",
  "C38 41.8 37.2 44.1 36.2 46.4 C35.3 48.7 34.3 51 33.3 53.2 C32.3 55.4 31.2 57.6 30 59.7",
  "C28.8 61.7 27.6 63.9 26 65.6 C24.5 67.3 22.5 68.5 20.7 69.8",
  "C18.8 71.1 16.7 71.9 15 73.3 C13.2 74.7 10.3 76.4 10.2 78.1",
  "C10 79.8 12.2 82.7 13.9 83.4 C15.5 84.1 18.1 82.9 20.2 82.4",
  "C22.3 82 24.3 80.9 26.4 80.6 C28.5 80.3 31.5 79.8 32.8 80.7",
  "C34.1 81.6 34.7 84.2 34.2 85.9 C33.6 87.7 31.2 89.7 29.6 91.2",
  "C27.9 92.8 26.1 94.2 24.2 95.3 C22.3 96.4 20.2 97.3 18.1 97.6",
  "C16 97.9 13.7 97.8 11.7 97.2 C9.6 96.6 7.5 95.5 5.8 94.1 C4.2 92.6 2.6 90.6 1.6 88.4",
  "C0.7 86.3 0 83.6 0 81.2 C0 78.8 0.7 76.2 1.5 73.9 C2.3 71.6 3.6 69.5 4.9 67.5",
  "C6.2 65.5 7.9 63.8 9.3 61.9 C10.7 60 12.1 58.1 13.4 56.2 C14.8 54.2 16 52.1 17.2 50",
  "C18.3 47.8 19.4 45.7 20.5 43.5 C21.5 41.3 22.5 39 23.4 36.7",
  "C24.3 34.4 25.2 32.1 26.1 29.8 C27 27.5 27.9 25.3 28.8 23",
  "C29.7 20.7 30.5 18.3 31.5 16.1 C32.5 13.8 33.4 11.5 34.6 9.4",
  "C35.8 7.4 37.2 5.3 38.8 3.7 C40.4 2.2 42.4 0.8 44.4 0.3Z",
].join(" ");

export type AcornMarkVariant = "solid" | "neon";
export type AcornMarkSize = "letter" | "sm" | "md" | "lg" | "xl";

/**
 * Solid is the orange ribbon for small sizes and the wordmark. Neon is the lit
 * tube from the brand art: white rim, pale gold body, warm glow. Size is the
 * mark's height; `letter` follows the surrounding text's cap height.
 */
export function AcornMark({
  variant = "solid",
  size = "md",
  label = "",
}: {
  variant?: AcornMarkVariant;
  size?: AcornMarkSize;
  /** Empty when a visible name sits beside the mark. */
  label?: string;
}) {
  return (
    <svg
      className={`acorn-mark acorn-mark-${size} acorn-mark-${variant}`}
      viewBox={ACORN_MARK_VIEW_BOX}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path className="acorn-mark-body" d={ACORN_MARK_PATH} />
    </svg>
  );
}
