import { useId } from "react";

/**
 * The glowing cursor icon, standing in for the "A" of "Acorn" in the slogan. Decoration for a letter
 * that stays in the text (see SloganPayoff), so it is hidden from assistive technology.
 */
export function CursorA() {
  const id = useId();
  const stroke = `${id}-stroke`;
  const fill = `${id}-fill`;
  return (
    <span className="ac-cursor-a" aria-hidden="true">
      <span className="ac-cursor-a-aura" />
      <svg className="ac-cursor-a-svg" viewBox="0 0 100 100" fill="none" focusable="false">
        <defs>
          <linearGradient id={stroke} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor="#ffe37a" />
            <stop offset="85%" stopColor="#ff9000" />
            <stop offset="100%" stopColor="#ff4800" />
          </linearGradient>
          <linearGradient id={fill} x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffa500" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <path
          d="M 50 14 C 62 14, 76 36, 83 62 C 89 82, 79 88, 66 84 C 56 80, 53 66, 50 66 C 47 66, 44 80, 34 84 C 21 88, 11 82, 17 62 C 24 36, 38 14, 50 14 Z"
          stroke={`url(#${stroke})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={`url(#${fill})`}
        />
        <path
          d="M 39 63 C 44 51, 56 51, 61 63"
          stroke={`url(#${stroke})`}
          strokeWidth="6.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
