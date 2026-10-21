import { RUN_POINT_STATE, type RunMap, type RunMapPoint } from "@acorn/shared/run-types";
import { useId, type MouseEvent } from "react";

import { formatPagePx, layoutMap, mapY, pageY, type MapLayout } from "./map-layout";
import { sameFocus, type RunFocus } from "./run-focus";

import type { RunQuestion } from "./run-questions";
import type { ShowTarget } from "./show-on-page";
import type { RunShot } from "../tab-run-shots";

/** Room at the column's left for the settled bar, and at its right for the survey's screens (map pixels). */
const GUTTER_LEFT_PX = 6;
const GUTTER_RIGHT_PX = 9;
/** The width of the settled bar and of a screen's tick, and how far each sits from the page (map pixels). */
const EDGE_BAR_PX = 3;
const EDGE_GAP_PX = 2;
/** The page's corners and a control's (map pixels). */
const PAPER_RADIUS_PX = 4;
const MARK_RADIUS_PX = 1.5;
/** The least a control or a stretch is drawn as, so a thin one still shows (map pixels). */
const MARK_MIN_PX = 2;
/** A point of the plan, and the ring round one that moved with its control (map pixels). */
const POINT_RADIUS_PX = 2.25;
const MOVED_RING_PX = 4.25;
/** How far from a question the pointer may be and still point at it (map pixels). */
const NEAR_PX = 10;
/** The teeth of a fold's torn edges (map pixels). */
const TOOTH_PX = 4;
const TOOTH_DEPTH_PX = 1.5;
/** The window's lens reaches this far past the page on each side, and its corners (map pixels). */
const LENS_OVERHANG_PX = 2;
const LENS_RADIUS_PX = 3;
/** The hatching of a stretch where the form moved (map pixels). */
const HATCH_PX = 4;

export interface PageMapProps {
  map: RunMap;
  questions: RunQuestion[];
  /** The pictures of the filmstrip, so the one pointed at is outlined on the page. */
  shots: RunShot[];
  focus: RunFocus | null;
  /** No run works on the page any more: what still waits on the person stands out. */
  ended: boolean;
  width: number;
  /** The tallest the map may be; a short page is drawn shorter. */
  height: number;
  onFocus: (focus: RunFocus | null) => void;
  /** Shows a field or a place on the page; unset while a run works there (it owns the scroll). */
  onPick?: (target: ShowTarget) => void;
}

/** A torn edge across the page at `y`, so a fold reads as a cut in it. */
function tornEdge(left: number, width: number, y: number, depth: number): string {
  const teeth = Math.max(1, Math.round(width / TOOTH_PX));
  const step = width / teeth;
  let path = `M ${left} ${y}`;
  for (let i = 0; i < teeth; i += 1) {
    path += ` L ${left + step * (i + 0.5)} ${y + depth} L ${left + step * (i + 1)} ${y}`;
  }
  return path;
}

/**
 * A mark of the map: a control, or a choice drawn as one bar round its radio buttons or check boxes, with
 * what became of its question ("button" for a control that asks nothing).
 */
type Mark = { id: string; x: number; y: number; w: number; h: number; status: string };

function choiceBox(question: RunQuestion): Mark {
  return { id: question.id, ...question.box, status: question.status };
}

/** The top and the height a stretch of the page is drawn at. */
function band(layout: MapLayout, from: number, to: number): { y: number; height: number } {
  const top = mapY(layout, from);
  return { y: top, height: Math.max(MARK_MIN_PX, mapY(layout, to) - top) };
}

/**
 * The map of the page in the Now card. The page is drawn as a sheet, folded where nothing is
 * (`map-layout.ts`); on it, in the design system's colors (`run-board.css`): the stretches the model
 * settled, washed in the accent with a bar at the left; where the form moved, hatched; where the plan first
 * acts, dashed; the page's fields, colored by what became of their question, and its buttons in grey; the
 * points of the plan; the screens of the last survey as ticks at the right; and the window as a lens that
 * glides with the scroll. Pointing at the map lights the nearest question in the list; once no run works on
 * the page, a click shows that question, or that place, on the page itself.
 */
export function PageMap(props: PageMapProps) {
  const { map, questions, shots, focus, ended, width, height, onFocus, onPick } = props;
  const ids = useId().replace(/:/g, "");
  const hatch = `acorn-map-hatch-${ids}`;
  const clip = `acorn-map-clip-${ids}`;
  const paper = {
    left: GUTTER_LEFT_PX,
    width: Math.max(1, width - GUTTER_LEFT_PX - GUTTER_RIGHT_PX),
  };
  const sx = paper.width / Math.max(1, map.pageWidth);
  const layout = layoutMap(
    map.pageHeight,
    [...map.controls, ...map.points.map((point) => ({ y: point.y, h: 1 }))],
    height,
  );
  const tall = Math.max(1, layout.height);
  const x = (page: number) => paper.left + page * sx;
  const statusOf = new Map(
    questions.flatMap((question) => question.controls.map((id) => [id, question.status])),
  );
  // Radio buttons and check boxes answering one question are drawn as that question: one bar round them.
  const choices = questions.filter((question) => question.kind === "choice");
  const inChoice = new Set(choices.flatMap((question) => question.controls));
  const marks: Mark[] = [
    ...map.controls
      .filter((control) => !inChoice.has(control.id))
      .map((control) => ({
        id: control.id,
        x: control.x,
        y: control.y,
        w: control.w,
        h: control.h,
        status: statusOf.get(control.id) ?? "button",
      })),
    ...choices.map(choiceBox),
  ];
  const focused =
    focus?.kind === "question" ? questions.find((question) => question.id === focus.id) : undefined;
  const lit = new Set(focused ? [focused.id, ...focused.controls] : []);
  const shot = focus?.kind === "shot" ? shots[focus.index] : undefined;
  const current = map.points.find((point) => point.state === RUN_POINT_STATE.current);
  const lens = band(layout, map.viewTop, map.viewTop + map.viewHeight);

  /** The question nearest a point of the map, within NEAR_PX. */
  const nearest = (mx: number, my: number): RunQuestion | undefined => {
    let best: RunQuestion | undefined;
    let closest = NEAR_PX;
    for (const question of questions) {
      const top = mapY(layout, question.box.y);
      const bottom = mapY(layout, question.box.y + question.box.h);
      const left = x(question.box.x);
      const right = x(question.box.x + question.box.w);
      const dy = my < top ? top - my : my > bottom ? my - bottom : 0;
      const dx = mx < left ? left - mx : mx > right ? mx - right : 0;
      // The first of the page's order wins a tie: two questions side by side, the pointer on neither.
      const off = Math.hypot(dx, dy);
      if (best ? off < closest : off <= closest) {
        best = question;
        closest = off;
      }
    }
    return best;
  };
  const at = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { mx: event.clientX - box.left, my: event.clientY - box.top };
  };
  const point = (event: MouseEvent<SVGSVGElement>) => {
    const { mx, my } = at(event);
    const question = nearest(mx, my);
    const next: RunFocus | null = question ? { kind: "question", id: question.id } : null;
    if (!sameFocus(next, focus)) onFocus(next);
  };
  const pick = (event: MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const { mx, my } = at(event);
    const question = nearest(mx, my);
    const [control] = question?.controls ?? [];
    onPick(question && control ? { control, y: question.box.y } : { y: pageY(layout, my) });
  };

  return (
    <svg
      className="acorn-map"
      width={width}
      height={tall}
      viewBox={`0 0 ${width} ${tall}`}
      aria-hidden="true"
      data-focus={focused ? "question" : shot ? "shot" : undefined}
      data-ended={ended ? "true" : undefined}
      data-pickable={onPick ? "true" : undefined}
      onMouseMove={point}
      onMouseLeave={() => {
        if (focus?.kind === "question") onFocus(null);
      }}
      onClick={pick}
    >
      <defs>
        <pattern
          id={hatch}
          width={HATCH_PX}
          height={HATCH_PX}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line className="acorn-map-hatch-line" x1={0} y1={0} x2={0} y2={HATCH_PX} />
        </pattern>
        <clipPath id={clip}>
          <rect x={paper.left} y={0} width={paper.width} height={tall} rx={PAPER_RADIUS_PX} />
        </clipPath>
      </defs>

      <rect
        className="acorn-map-paper"
        x={paper.left}
        y={0}
        width={paper.width}
        height={tall}
        rx={PAPER_RADIUS_PX}
      />
      <g clipPath={`url(#${clip})`}>
        {layout.segments
          .filter((segment) => segment.folded)
          .map((segment) => (
            <g key={`fold-${segment.from}`} className="acorn-map-fold">
              <rect x={paper.left} y={segment.top} width={paper.width} height={segment.height} />
              <path
                className="acorn-map-fold-edge"
                d={tornEdge(paper.left, paper.width, segment.top, TOOTH_DEPTH_PX)}
              />
              <path
                className="acorn-map-fold-edge"
                d={tornEdge(paper.left, paper.width, segment.top + segment.height, -TOOTH_DEPTH_PX)}
              />
              <text
                className="acorn-map-fold-label"
                x={paper.left + paper.width / 2}
                y={segment.top + segment.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {formatPagePx(segment.to - segment.from)}
              </text>
            </g>
          ))}
        {map.settled.map((span) => (
          <rect
            key={`settled-${span.from}`}
            className="acorn-map-settled"
            x={paper.left}
            width={paper.width}
            {...band(layout, span.from, span.to)}
          />
        ))}
        {map.moves.map((move) => (
          <rect
            key={`moved-${move.from}-${move.at}`}
            className="acorn-map-moved"
            fill={`url(#${hatch})`}
            x={paper.left}
            width={paper.width}
            {...band(layout, Math.min(move.from, move.at), Math.max(move.from, move.at))}
          />
        ))}
        {map.key ? (
          <rect
            className="acorn-map-key"
            x={paper.left}
            width={paper.width}
            {...band(layout, map.key.from, map.key.to)}
          />
        ) : null}
        {map.fence != null ? (
          <line
            className="acorn-map-fence"
            x1={paper.left}
            x2={paper.left + paper.width}
            y1={mapY(layout, map.fence)}
            y2={mapY(layout, map.fence)}
          />
        ) : null}
        {marks.map((mark) => {
          const drawn = band(layout, mark.y, mark.y + mark.h);
          return (
            <rect
              key={mark.id}
              className="acorn-map-mark"
              data-status={mark.status}
              data-lit={lit.has(mark.id) ? "true" : undefined}
              x={x(mark.x)}
              width={Math.max(MARK_MIN_PX, mark.w * sx)}
              rx={Math.min(MARK_RADIUS_PX, drawn.height / 2)}
              {...drawn}
            />
          );
        })}
        {map.points.map((one) => (
          <PlanPoint key={one.id} point={one} cx={x(one.x)} cy={mapY(layout, one.y)} />
        ))}
      </g>

      {focused ? (
        <line
          className="acorn-map-guide"
          x1={0}
          x2={width}
          y1={mapY(layout, focused.box.y + focused.box.h / 2)}
          y2={mapY(layout, focused.box.y + focused.box.h / 2)}
        />
      ) : null}
      {shot ? (
        <rect
          className="acorn-map-shot"
          x={paper.left - LENS_OVERHANG_PX}
          width={paper.width + LENS_OVERHANG_PX * 2}
          rx={LENS_RADIUS_PX}
          {...band(layout, shot.top, shot.top + shot.height)}
        />
      ) : null}
      {map.settled.map((span) => (
        <rect
          key={`edge-${span.from}`}
          className="acorn-map-settled-edge"
          x={paper.left - EDGE_GAP_PX - EDGE_BAR_PX}
          width={EDGE_BAR_PX}
          rx={EDGE_BAR_PX / 2}
          {...band(layout, span.from, span.to)}
        />
      ))}
      {map.screens.map((screen) => {
        const drawn = band(layout, screen.top, screen.top + screen.height);
        // A screen folded away with the empty stretch it showed is not drawn: it would be a dot.
        if (mapY(layout, screen.top + screen.height) - drawn.y < MARK_MIN_PX) return null;
        return (
          <rect
            key={`screen-${screen.top}`}
            className="acorn-map-screen"
            data-reused={screen.reused ? "true" : undefined}
            x={paper.left + paper.width + EDGE_GAP_PX}
            width={EDGE_BAR_PX}
            rx={EDGE_BAR_PX / 2}
            y={drawn.y + 0.5}
            height={Math.max(1, drawn.height - 1)}
          />
        );
      })}
      <g className="acorn-map-lens" style={{ transform: `translateY(${lens.y}px)` }}>
        <rect
          x={paper.left - LENS_OVERHANG_PX}
          y={0}
          width={paper.width + LENS_OVERHANG_PX * 2}
          height={lens.height}
          rx={LENS_RADIUS_PX}
        />
      </g>
      {current ? (
        <circle
          key={`pulse-${current.id}`}
          className="acorn-map-pulse"
          cx={x(current.x)}
          cy={mapY(layout, current.y)}
          r={POINT_RADIUS_PX}
        />
      ) : null}
    </svg>
  );
}

/** A point of the plan: a ring to do, a dot done, being done or failed, a faint ring skipped. */
function PlanPoint({ point, cx, cy }: { point: RunMapPoint; cx: number; cy: number }) {
  return (
    <g className="acorn-map-point" data-state={point.state}>
      {point.moved ? (
        <circle className="acorn-map-point-moved" cx={cx} cy={cy} r={MOVED_RING_PX} />
      ) : null}
      <circle className="acorn-map-dot" cx={cx} cy={cy} r={POINT_RADIUS_PX} />
    </g>
  );
}
