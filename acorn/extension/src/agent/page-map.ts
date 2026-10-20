/**
 * The minimap of the page a Run is on, for the sidebar's Now card: the page as a narrow column, the parts
 * the model settled painted, the window as a box. This keeps what the card draws from; the picture is the
 * sidebar's own (it is drawn there, not on the page the person is reading).
 */

import type { Shot } from "./capture";
import type { SettledMap } from "./survey";
import type { RunMap } from "@acorn/shared/run-types";

/** A page this many times taller than its window has a minimap; one that fits has nothing to map. */
export const MAP_MIN_PAGE_RATIO = 1.1;

/**
 * The page a look is of, without the place on it the address names: an Apply button that jumps to the
 * form below changes the fragment (`#application`) and not the page, so it is not a new page that is
 * looked at from its top, and what was settled on it holds.
 */
export function pageKey(url: string | undefined, title: string | undefined): string {
  const [page] = (url ?? "").split("#");
  return `${page ?? ""}\n${title ?? ""}`;
}

/** Keeps the map of the page the run is on and says it when asked. */
export class PageMapKeeper {
  private map: RunMap | undefined;
  private scale = 1;

  /** The map for the sidebar, or undefined when the run does not survey or the page fits its window. */
  get current(): RunMap | undefined {
    return this.map;
  }

  /**
   * A look at the page: how tall it is and where the window is. `settled` is what the agent last said
   * (screenshot pixels). A run that does not survey has no minimap.
   */
  look(shot: Shot, settled: SettledMap | null, surveys: boolean): void {
    if (!surveys) {
      this.map = undefined;
      return;
    }
    this.scale = shot.scale;
    const pageHeight = shot.viewport.pageHeight / shot.scale;
    const viewHeight = shot.viewport.height / shot.scale;
    if (pageHeight < viewHeight * MAP_MIN_PAGE_RATIO) {
      this.map = undefined;
      return;
    }
    this.map = {
      pageHeight,
      viewHeight,
      viewTop: shot.viewport.scrollY / shot.scale,
      settled: this.spans(settled),
    };
  }

  /** The agent says what is settled now (an empty map: nothing). */
  settle(settled: SettledMap): void {
    if (this.map) this.map = { ...this.map, settled: this.spans(settled) };
  }

  /** The window moved to a place (CSS pixels). */
  moveTo(viewTop: number): void {
    if (this.map) this.map = { ...this.map, viewTop };
  }

  /** A new page: the map of the last one is gone. */
  clear(): void {
    this.map = undefined;
  }

  private spans(settled: SettledMap | null): { from: number; to: number }[] {
    return (settled?.spans ?? []).map((span) => ({
      from: span.from / this.scale,
      to: span.to / this.scale,
    }));
  }
}
