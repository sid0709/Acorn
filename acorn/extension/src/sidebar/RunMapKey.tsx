import { useId } from "react";
import { Collapsible, Text } from "sid-ui";

import { QUESTION_STATUS } from "./run-questions";

/** A swatch's size (pixels): wide enough for a field's bar, as tall as a line of the key. */
const SWATCH_W_PX = 16;
const SWATCH_H_PX = 10;

/** The marks of the map and what each means, in the order the key lists them. */
const KEY = [
  { mark: QUESTION_STATUS.answered, label: "Answered" },
  { mark: QUESTION_STATUS.doing, label: "Filling now" },
  { mark: QUESTION_STATUS.next, label: "Up next" },
  { mark: QUESTION_STATUS.open, label: "To answer" },
  { mark: "needs-you", label: "Needs you" },
  { mark: QUESTION_STATUS.problem, label: "Flagged" },
  { mark: QUESTION_STATUS.blank, label: "Left empty" },
  { mark: "button", label: "Button" },
  { mark: "point", label: "Plan’s click" },
  { mark: "settled", label: "Settled" },
  { mark: "lens", label: "On screen" },
  { mark: "screen", label: "Photographed" },
  { mark: "reused", label: "Photo reused" },
  { mark: "moved", label: "Form moved" },
  { mark: "fence", label: "Plan starts" },
  { mark: "fold", label: "Empty, folded" },
] as const;
type KeyMark = (typeof KEY)[number]["mark"];

/** A mark as the map draws it, in the same classes, so the key cannot say another color than the map. */
function Swatch({ mark }: { mark: KeyMark }) {
  const hatch = `acorn-key-hatch-${useId().replace(/:/g, "")}`;
  const bar = { x: 1, y: 3, width: SWATCH_W_PX - 2, height: SWATCH_H_PX - 6, rx: 1.5 };
  const whole = { x: 0, y: 0, width: SWATCH_W_PX, height: SWATCH_H_PX };
  const shape = (() => {
    switch (mark) {
      case "needs-you":
        return <rect className="acorn-map-mark" data-status={QUESTION_STATUS.open} {...bar} />;
      case "point":
        return (
          <g className="acorn-map-point" data-state="pending">
            <circle className="acorn-map-dot" cx={SWATCH_W_PX / 2} cy={SWATCH_H_PX / 2} r={2.5} />
          </g>
        );
      case "settled":
        return (
          <>
            <rect className="acorn-map-settled" {...whole} />
            <rect className="acorn-map-settled-edge" x={0} y={0} width={3} height={SWATCH_H_PX} />
          </>
        );
      case "lens":
        return (
          <g className="acorn-map-lens">
            <rect x={1} y={1} width={SWATCH_W_PX - 2} height={SWATCH_H_PX - 2} rx={2} />
          </g>
        );
      case "screen":
      case "reused":
        return (
          <rect
            className="acorn-map-screen"
            data-reused={mark === "reused" ? "true" : undefined}
            x={SWATCH_W_PX / 2 - 1.5}
            y={0}
            width={3}
            height={SWATCH_H_PX}
            rx={1.5}
          />
        );
      case "moved":
        return (
          <>
            <defs>
              <pattern
                id={hatch}
                width={4}
                height={4}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line className="acorn-map-hatch-line" x1={0} y1={0} x2={0} y2={4} />
              </pattern>
            </defs>
            <rect className="acorn-map-moved" fill={`url(#${hatch})`} {...whole} />
          </>
        );
      case "fence":
        return (
          <line
            className="acorn-map-fence"
            x1={0}
            x2={SWATCH_W_PX}
            y1={SWATCH_H_PX / 2}
            y2={SWATCH_H_PX / 2}
          />
        );
      case "fold":
        return (
          <g className="acorn-map-fold">
            <rect {...whole} />
            <path
              className="acorn-map-fold-edge"
              d={`M 0 2 L 2 3.5 L 4 2 L 6 3.5 L 8 2 L 10 3.5 L 12 2 L 14 3.5 L 16 2`}
            />
            <path
              className="acorn-map-fold-edge"
              d={`M 0 8 L 2 6.5 L 4 8 L 6 6.5 L 8 8 L 10 6.5 L 12 8 L 14 6.5 L 16 8`}
            />
          </g>
        );
      default:
        return <rect className="acorn-map-mark" data-status={mark} {...bar} />;
    }
  })();
  return (
    <svg
      className="acorn-map acorn-map-swatch"
      width={SWATCH_W_PX}
      height={SWATCH_H_PX}
      viewBox={`0 0 ${SWATCH_W_PX} ${SWATCH_H_PX}`}
      aria-hidden="true"
      data-ended={mark === "needs-you" ? "true" : undefined}
    >
      {shape}
    </svg>
  );
}

/** What the marks of the map mean, folded away under the board until asked for. */
export function RunMapKey() {
  return (
    <Collapsible
      defaultIsOpen={false}
      trigger={<Text type="supporting">What the map’s marks mean</Text>}
    >
      <ul className="acorn-map-key">
        {KEY.map((item) => (
          <li key={item.mark}>
            <Swatch mark={item.mark} />
            <Text type="supporting">{item.label}</Text>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}
