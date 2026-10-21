/**
 * The Now card's filmstrip: the pictures the model was sent with its last look (the screens of a survey, or
 * the zone photos and the look's own screenshot), made small and kept for each of the run's tabs
 * (`tab-run-shots.ts`). They are made beside the run and never in its way: a look that cannot be shown is
 * left out and logged.
 */

import { saveTabRunShots, type RunShot } from "../tab-run-shots";

import { resizeJpeg, type Shot } from "./capture";

import type { AgentSurveyScreen, AgentZoneShot } from "@acorn/shared/agent-contract";

/** The widest a filmstrip picture is (pixels): wide enough to zoom into in the panel. */
export const RUN_SHOT_WIDTH_PX = 720;
/** JPEG quality of a filmstrip picture (0 to 100). */
export const RUN_SHOT_QUALITY = 60;
/** The most pictures kept of one look. */
export const RUN_SHOTS_MAX = 12;

/** A picture of the look, in the screenshot's pixels: where the page was scrolled to when it was taken. */
type Source = { screenshot: string; scrollY: number; reused: boolean };

/** The look's pictures, top to bottom for a survey, in the order they were taken otherwise. */
function sourcesOf(
  look: Shot,
  survey: AgentSurveyScreen[] | null,
  fresh: number[],
  zones: AgentZoneShot[],
): Source[] {
  if (survey && survey.length > 0) {
    const taken = new Set(fresh.map((y) => Math.round(y)));
    return survey.map((screen) => ({
      screenshot: screen.screenshot,
      scrollY: screen.scrollY,
      reused: !taken.has(Math.round(screen.scrollY)),
    }));
  }
  return [
    ...zones.map((zone) => ({ screenshot: zone.screenshot, scrollY: zone.scrollY, reused: false })),
    { screenshot: look.dataUrl, scrollY: look.viewport.scrollY, reused: false },
  ];
}

/** Names a picture without reading all of it: its place, its length and its last bytes. */
function sourceKey(source: Source): string {
  return `${Math.round(source.scrollY)}:${source.screenshot.length}:${source.screenshot.slice(-48)}`;
}

/** Keeps the filmstrip of one run. */
export class RunShotsKeeper {
  /** Pictures made, by the picture they were made from: a survey sends its earlier screens again. */
  private made = new Map<string, Promise<string>>();
  /** The look last saved, so the same pictures are not saved again. */
  private saved = "";

  constructor(
    private readonly runId: string,
    private readonly onError: (err: unknown) => void,
  ) {}

  /**
   * Saves the pictures of a look for the run's tabs: a survey's screens (`fresh` the scroll positions
   * photographed for it, the rest were reused), or else the zone photos and the look's own screenshot.
   */
  async publish(
    tabIds: number[],
    look: Shot,
    survey: AgentSurveyScreen[] | null,
    fresh: number[],
    zones: AgentZoneShot[],
  ): Promise<void> {
    const tabs = [...tabIds];
    const items = sourcesOf(look, survey, fresh, zones)
      .slice(0, RUN_SHOTS_MAX)
      .map((source) => {
        const key = sourceKey(source);
        return { source, key, picture: this.made.get(key) ?? this.small(source, look) };
      });
    const signature = items.map((item) => item.key).join("|");
    if (signature === this.saved) return;
    this.saved = signature;
    this.made = new Map(items.map((item) => [item.key, item.picture]));
    try {
      const shots: RunShot[] = await Promise.all(
        items.map(async ({ source, picture }) => ({
          src: await picture,
          left: look.viewport.scrollX / look.scale,
          top: source.scrollY / look.scale,
          width: look.viewport.width / look.scale,
          height: look.viewport.height / look.scale,
          reused: source.reused,
        })),
      );
      // A later look saved while these were made wins.
      if (this.saved !== signature) return;
      const at = Date.now();
      await Promise.all(
        tabs.map((tabId) => saveTabRunShots(tabId, { runId: this.runId, at, shots })),
      );
    } catch (err) {
      // Nothing failed is kept: the next look makes its pictures again.
      this.made = new Map();
      if (this.saved === signature) this.saved = "";
      this.onError(err);
    }
  }

  /** A picture made small for the panel; one already small enough is kept as it is. */
  private async small(source: Source, look: Shot): Promise<string> {
    const { width, height } = look.viewport;
    if (width <= RUN_SHOT_WIDTH_PX) return source.screenshot;
    const base64 = source.screenshot.slice(source.screenshot.indexOf(",") + 1);
    const w = RUN_SHOT_WIDTH_PX;
    const h = Math.max(1, Math.round((height * RUN_SHOT_WIDTH_PX) / width));
    return `data:image/jpeg;base64,${await resizeJpeg(base64, w, h, RUN_SHOT_QUALITY)}`;
  }
}
