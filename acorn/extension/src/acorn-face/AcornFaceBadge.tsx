import { AcornFaceSlot } from "./AcornFaceSlot";
import { ACORN_FACE_BADGE_OVERHANG, ACORN_FACE_BADGE_PX } from "./constants";

import type { AcornFaceMode } from "@acorn/face";

type AcornFaceBadgeProps = {
  mode: AcornFaceMode;
  selected?: boolean;
  label: string;
};

export function AcornFaceBadge({ mode, selected = false, label }: AcornFaceBadgeProps) {
  const shift = `${ACORN_FACE_BADGE_OVERHANG * 100}%`;

  return (
    <span
      className="acorn-face-badge"
      style={{
        width: ACORN_FACE_BADGE_PX,
        height: ACORN_FACE_BADGE_PX,
        transform: `translate(${shift}, ${shift})`,
      }}
    >
      <AcornFaceSlot mode={mode} selected={selected} size={ACORN_FACE_BADGE_PX} label={label} />
    </span>
  );
}
