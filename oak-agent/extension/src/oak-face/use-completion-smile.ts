import { useEffect, useRef, useState } from "react";
import type { OakFaceMode } from "@oak/face";
import type { PipelinePhase } from "../../../shared/pipeline-types";
import type { JdShotStatus } from "../tab-page-session";
import { FACE_SMILE_MS, FACE_WINK_MS } from "./constants";
import { mergeFaceShot } from "./director";

/** Smile once when a fill or a JD shot completes. */
export function useCompletionSmile(input: {
  hold: OakFaceMode;
  fillPhase?: PipelinePhase | null;
  jdStatus?: JdShotStatus | null;
  winkToken?: number;
}): OakFaceMode {
  const [shot, setShot] = useState<OakFaceMode | null>(null);
  const prevFill = useRef(input.fillPhase);
  const prevJd = useRef(input.jdStatus);
  const prevWink = useRef(input.winkToken);

  useEffect(() => {
    const fill = input.fillPhase;
    if (prevFill.current !== "done" && fill === "done") {
      setShot("smile");
      const timer = window.setTimeout(() => setShot(null), FACE_SMILE_MS);
      prevFill.current = fill;
      return () => window.clearTimeout(timer);
    }
    prevFill.current = fill;
    return undefined;
  }, [input.fillPhase]);

  useEffect(() => {
    const jd = input.jdStatus;
    if (prevJd.current === "running" && jd === "found") {
      setShot("smile");
      const timer = window.setTimeout(() => setShot(null), FACE_SMILE_MS);
      prevJd.current = jd;
      return () => window.clearTimeout(timer);
    }
    prevJd.current = jd;
    return undefined;
  }, [input.jdStatus]);

  useEffect(() => {
    const token = input.winkToken;
    if (token && token !== prevWink.current) {
      prevWink.current = token;
      setShot("wink");
      const timer = window.setTimeout(() => setShot(null), FACE_WINK_MS);
      return () => window.clearTimeout(timer);
    }
    prevWink.current = token;
    return undefined;
  }, [input.winkToken]);

  return mergeFaceShot(input.hold, shot);
}
