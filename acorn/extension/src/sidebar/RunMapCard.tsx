import { RUN_MAP_PHASE, type RunMap } from "@acorn/shared/run-types";
import { useEffect, useRef } from "react";
import { Badge, Card, HStack, Text, VStack } from "sid-ui";

import { MAP_LEGEND, PHASE_LABEL, drawRunMap, mapCaption } from "./page-minimap";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";

type PhaseBadge = { variant: "neutral" | "warning" | "success" | "error"; label: string };

/** What the run is doing, as a badge: neutral while it works, a warning while it waits on the person, green or red once it ended. */
function phaseBadge(map: RunMap | null, failed: boolean): PhaseBadge {
  if (!map) return { variant: "neutral", label: "No run yet" };
  if (map.phase === RUN_MAP_PHASE.waiting) {
    return { variant: "warning", label: PHASE_LABEL[map.phase] };
  }
  if (map.phase === RUN_MAP_PHASE.ended) {
    return { variant: failed ? "error" : "success", label: PHASE_LABEL[map.phase] };
  }
  return { variant: "neutral", label: PHASE_LABEL[map.phase] };
}

/**
 * The map of the page the run on this tab is on, under the Now card. It is always there: an empty page
 * before the first run, the live page while a run works, and the last page once it ended, so a run can be
 * followed and read back. The picture is drawn by `page-minimap.ts`; the legend says what each mark means.
 */
export function RunMapCard({ progress }: { progress: PipelineProgress }) {
  const run = progress.run;
  const map = run?.map ?? null;
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const box = frame.current;
    if (!el || !box) return;
    const draw = () => drawRunMap(el, map, box.clientWidth);
    draw();
    // The card's width (the panel resized) and the theme change the picture without changing the map.
    const sizes = new ResizeObserver(draw);
    sizes.observe(box);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", draw);
    return () => {
      sizes.disconnect();
      scheme.removeEventListener("change", draw);
    };
  }, [map]);

  const badge = phaseBadge(map, Boolean(run?.report?.failure));
  const caption = mapCaption(map);
  return (
    <Card padding={4} className="acorn-map-card" elevation="low">
      <VStack gap={3}>
        <HStack gap={2} align="center" justify="between">
          <Text type="supporting" weight="semibold" color="accent">
            Page map
          </Text>
          <HStack gap={2} align="center">
            {run?.step ? <Text type="supporting">Step {run.step}</Text> : null}
            <Badge variant={badge.variant} label={badge.label} />
          </HStack>
        </HStack>
        <div ref={frame} className="acorn-map-frame">
          <canvas ref={canvas} className="acorn-map" role="img" aria-label={caption} />
        </div>
        <Text type="supporting">{caption}</Text>
        <ul className="acorn-map-legend" aria-label="What the map shows">
          {MAP_LEGEND.map((item) => (
            <li key={item.mark}>
              <span className="acorn-map-key" data-mark={item.mark} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </VStack>
    </Card>
  );
}
