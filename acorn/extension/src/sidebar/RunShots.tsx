import { useState } from "react";
import { ClickableCard, HStack, Lightbox, Text, VStack } from "sid-ui";

import { formatPagePx } from "./map-layout";

import type { RunFocus } from "./run-focus";
import type { RunShot } from "../tab-run-shots";
import type { RunMapPoint } from "@acorn/shared/run-types";

/** The points of the plan that lie on a picture, as shares of its width and height. */
function dotsOn(shot: RunShot, points: RunMapPoint[]) {
  return points.flatMap((point) => {
    const left = (point.x - shot.left) / shot.width;
    const top = (point.y - shot.top) / shot.height;
    const inside = left >= 0 && left <= 1 && top >= 0 && top <= 1;
    return inside ? [{ id: point.id, state: point.state, left, top }] : [];
  });
}

function captionOf(shot: RunShot, index: number, count: number): string {
  return [
    `Screen ${index + 1} of ${count}`,
    `${formatPagePx(shot.top)}–${formatPagePx(shot.top + shot.height)} px down the page`,
    shot.reused ? "reused from an earlier look" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

interface RunShotsProps {
  shots: RunShot[];
  /** The points of the plan, drawn on the pictures they lie on. */
  points: RunMapPoint[];
  focus: RunFocus | null;
  onFocusChange: (focus: RunFocus | null) => void;
}

/**
 * What the model saw on its last look, as a strip of pictures with the plan's points on them: pointing at
 * one outlines its part of the page on the map, and a click opens it large, to zoom into and page through.
 */
export function RunShots({ shots, points, focus, onFocusChange }: RunShotsProps) {
  const [open, setOpen] = useState<number | null>(null);
  const fresh = shots.filter((shot) => !shot.reused).length;
  const summary =
    shots.length === 1
      ? "1 screen"
      : `${shots.length} screens${fresh < shots.length ? ` · ${fresh} new` : ""}`;
  const lit = focus?.kind === "shot" ? focus.index : undefined;

  return (
    <VStack gap={2}>
      <HStack gap={2} align="center" justify="between">
        <Text type="supporting" weight="semibold">
          What the model saw
        </Text>
        <Text type="supporting">{summary}</Text>
      </HStack>
      <ul className="acorn-shots">
        {shots.map((shot, index) => (
          <li key={`${index}-${shot.top}`} className="acorn-shot-cell">
            <ClickableCard
              label={captionOf(shot, index, shots.length)}
              padding={0}
              className="acorn-shot"
              data-lit={lit === index ? "true" : undefined}
              data-reused={shot.reused ? "true" : undefined}
              onClick={() => setOpen(index)}
              onMouseEnter={() => onFocusChange({ kind: "shot", index })}
              onMouseLeave={() => onFocusChange(null)}
            >
              <img
                className="acorn-shot-image"
                src={shot.src}
                alt=""
                style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
              />
              {dotsOn(shot, points).map((dot) => (
                <span
                  key={dot.id}
                  className="acorn-shot-dot"
                  data-state={dot.state}
                  style={{ left: `${dot.left * 100}%`, top: `${dot.top * 100}%` }}
                />
              ))}
              <span className="acorn-shot-number">{index + 1}</span>
            </ClickableCard>
          </li>
        ))}
      </ul>
      <Lightbox
        isOpen={open != null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpen(null);
        }}
        media={shots.map((shot, index) => ({
          src: shot.src,
          alt: `What the model saw, screen ${index + 1} of ${shots.length}`,
          caption: captionOf(shot, index, shots.length),
        }))}
        index={Math.min(open ?? 0, Math.max(0, shots.length - 1))}
        onIndexChange={setOpen}
        hasZoom
      />
    </VStack>
  );
}
