/** A dot in a document color. The color is résumé data (palettes, section headings), not app chrome. */
export function Swatch({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill={color} />
    </svg>
  );
}
