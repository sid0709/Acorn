import { resolveDropdownInteractionTarget } from "./enhanced-select";
import { fillNativeSelect } from "./native-select";
import { pointerActivate } from "./pointer-activate";
import { readControlValue } from "./read-control-value";
import { traceFromPage } from "../../debug-trace";
import { chooseOption } from "./combobox/choose-option";
import { optionText } from "./combobox/options-dom";
import { findLiveOption } from "./combobox/options-wait";
import { dismissOpenOverlays, settlePopupClosed } from "./combobox/typing";

export interface ComboboxFillOptions {
  /** Type into the search box to narrow a long list (default true). */
  allowTypeahead?: boolean;
  /** `value` is an instruction, not a search: a long list types the writer's estimate instead. */
  estimateQuery?: boolean;
  /** See ChooseOptions: a writer estimate already requested. */
  estimate?: Promise<string | null>;
  /** See ChooseOptions: the list was read already; type the query right away. */
  searchFirst?: boolean;
}

/** Choose the option for `value` (see chooseOption), click it, and leave the popup closed. */
export async function selectComboboxOption(
  el: Element,
  value: string,
  fieldHint?: string | null,
  { allowTypeahead = true, estimateQuery = false, estimate, searchFirst }: ComboboxFillOptions = {},
): Promise<string> {
  const requested = el as HTMLElement;
  if (requested instanceof HTMLSelectElement) {
    return fillNativeSelect(requested, value);
  }
  const html = resolveDropdownInteractionTarget(requested);
  if (html instanceof HTMLSelectElement) {
    return fillNativeSelect(html, value);
  }
  const doc = html.ownerDocument || document;
  const fromDom =
    html.getAttribute("aria-label") ||
    requested.getAttribute("aria-label") ||
    (html.id
      ? doc.querySelector(`label[for="${CSS.escape(html.id)}"]`)?.textContent?.trim()
      : null) ||
    (requested.id
      ? doc.querySelector(`label[for="${CSS.escape(requested.id)}"]`)?.textContent?.trim()
      : null) ||
    null;
  const fieldLabel =
    [fieldHint, fromDom]
      .map((part) =>
        String(part || "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .filter(
        (part, i, all) =>
          all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === i,
      )
      .join(" ") || null;

  const { match, options } = await chooseOption(html, doc, value, fieldLabel, {
    allowTypeahead,
    estimateQuery,
    estimate,
    searchFirst,
  });
  if (!match) {
    dismissOpenOverlays(doc, html);
    throw new Error(
      `No combobox option matching "${value}" (saw: ${options
        .slice(0, 6)
        .map(optionText)
        .join(" | ")})`,
    );
  }

  const label = optionText(match);
  traceFromPage("combo:click", () => ({ value, label, connected: match.isConnected }));
  const clickStarted = Date.now();
  const live = match.isConnected ? match : await findLiveOption(html, doc, label);
  const clickTarget = live || match;
  clickTarget.scrollIntoView({ block: "nearest", behavior: "auto" });
  pointerActivate(clickTarget);
  const closed = await settlePopupClosed(html, doc);

  const displayed = readControlValue(html);
  traceFromPage("combo:after-click", () => ({
    ms: Date.now() - clickStarted,
    value,
    label,
    closed,
    displayed,
    inputValue: html instanceof HTMLInputElement ? html.value : undefined,
  }));
  const selected =
    displayed ||
    (html instanceof HTMLInputElement && html.value) ||
    html.getAttribute("data-value") ||
    optionText(match);

  return selected;
}
