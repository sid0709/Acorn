import { useState, type CSSProperties } from "react";
import { Badge, Card, Glyph, HStack, Text, VStack } from "sid-ui";

import { AcornFaceView } from "../acorn-face/AcornFaceView";
import { ACORN_FACE_CELEBRATE_PX } from "../acorn-face/constants";

import { formatRunDuration } from "./RunTimer";

import type { RunProgress } from "@acorn/shared/run-types";

/** Confetti pieces in one burst. */
const CONFETTI_PIECES = 28;
/** Turn between neighbouring pieces: the golden angle, so the burst spreads evenly without a pattern. */
const CONFETTI_TURN = 0.381966;
/** Pieces fly between this share of the full reach and all of it, so the burst has depth. */
const CONFETTI_MIN_REACH = 0.55;
/** Pieces leave in this many waves, so the burst rolls out instead of popping at once. */
const CONFETTI_WAVES = 4;
/**
 * A run that ended within this long ago bursts when the card shows it. An older one
 * (the sidebar reopened later, or the tab switched back to) only shows the result.
 */
const CELEBRATION_FRESH_MS = 15_000;

/** Where each piece flies: its direction, how far, and which wave it leaves in. */
const PIECES = Array.from({ length: CONFETTI_PIECES }, (_, i) => {
  const turn = (i * CONFETTI_TURN) % 1;
  const reach = CONFETTI_MIN_REACH + (1 - CONFETTI_MIN_REACH) * ((i * CONFETTI_TURN * 2) % 1);
  return {
    "--acorn-confetti-turn": `${turn}turn`,
    "--acorn-confetti-reach": String(reach),
    "--acorn-confetti-wave": String(i % CONFETTI_WAVES),
  } as CSSProperties;
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card padding={3} variant="muted" className="acorn-celebrate-stat">
      <VStack gap={0}>
        <Text type="large" weight="bold" hasTabularNumbers justify="center">
          {value}
        </Text>
        <Text type="supporting" justify="center">
          {label}
        </Text>
      </VStack>
    </Card>
  );
}

/**
 * The application went in: a smiling acorn, a confetti burst, and what the run took.
 * Shown for any site, from the run's own completed outcome.
 */
export function RunCelebration({ run }: { run: RunProgress }) {
  const ended = run.endedAt ?? Date.now();
  // Decided once per run (the caller keys this by run): a re-render never restarts the burst.
  const [burst] = useState(() => Date.now() - ended < CELEBRATION_FRESH_MS);
  const pages = Math.max(run.report?.pages ?? run.page, 1);

  return (
    <VStack gap={3} className="acorn-celebrate" role="status" aria-live="polite">
      <div className={`acorn-celebrate-stage${burst ? " is-fresh" : ""}`}>
        {burst ? (
          <div className="acorn-confetti" aria-hidden>
            {PIECES.map((style, i) => (
              <span key={i} className="acorn-confetti-piece" style={style} />
            ))}
          </div>
        ) : null}
        <div className="acorn-celebrate-face">
          <AcornFaceView mode="smile" size={ACORN_FACE_CELEBRATE_PX} label="Acorn" />
        </div>
      </div>
      <VStack gap={1} align="center">
        <Badge variant="green" icon={<Glyph name="check" />} label="Applied" />
        <Text type="display-3" weight="bold" justify="center">
          Application sent!
        </Text>
        <Text type="supporting" justify="center">
          Acorn filled every step and sent it. Good luck!
        </Text>
      </VStack>
      <HStack gap={2} className="acorn-celebrate-stats">
        {run.startedAt ? (
          <Stat label="Time" value={formatRunDuration(ended - run.startedAt)} />
        ) : null}
        <Stat label={pages === 1 ? "Page" : "Pages"} value={String(pages)} />
      </HStack>
    </VStack>
  );
}
