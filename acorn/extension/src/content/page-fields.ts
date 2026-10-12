/**
 * The fields a page asks a person to fill on the page itself, as opposed to the
 * fields of a layer laid over it (a consent panel, a dialog). When a page and the
 * frame embedded in it both hold fields, the one with fields of its own is where
 * the application is. Structural only: no class names, ids, or wording.
 */

import { isPersonFacing } from "./form-dom";
import { FILLABLE_SELECTOR } from "./form-frame";
import { pageLayers } from "./page-layers";
import { queryDeep } from "./query-deep";

/** Fields a person can see and use on this frame's page, outside every open dialog. */
export function pageFieldScore(doc: Document = document): number {
  const layersOf = pageLayers();
  return queryDeep(doc, FILLABLE_SELECTOR).filter(
    (el) => isPersonFacing(el) && layersOf(el).dialogOf(el) == null,
  ).length;
}
