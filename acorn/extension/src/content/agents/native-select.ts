import { JEV_LIST_MAX } from "./combobox/choose-option";
import { askAiMatchOption } from "./match-option-client";
import { stripChoiceMarker } from "./string-similarity";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[–—]/g, "-").trim().toLowerCase();
}

function optionLabel(option: HTMLOptionElement): string {
  return (option.textContent || option.label || option.value || "").replace(/\s+/g, " ").trim();
}

function isPlaceholderOption(text: string): boolean {
  const n = normalize(text);
  if (!n) return true;
  const stripped = n.replace(/^[—\-–•·.|]+|[—\-–•·.|]+$/g, "").trim();
  if (!stripped) return true;
  return /^(select(\s|$)|choose(\s|$)|pick(\s|$)|make a selection|please select)/i.test(stripped);
}

function realOptions(select: HTMLSelectElement): HTMLOptionElement[] {
  return Array.from(select.options).filter((option) => !isPlaceholderOption(optionLabel(option)));
}

function labelsMatch(intended: string, option: HTMLOptionElement): boolean {
  const want = normalize(intended);
  const wantBare = normalize(stripChoiceMarker(intended));
  const label = optionLabel(option);
  const have = normalize(label);
  const haveBare = normalize(stripChoiceMarker(label));
  const value = normalize(option.value);
  if (!want) return false;
  if (have === want || haveBare === wantBare) return true;
  if (value && value === want) return true;
  return false;
}

function fieldLabelFor(select: HTMLSelectElement): string | null {
  const aria = select.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const id = select.id;
  if (!id || !select.ownerDocument) return null;
  return (
    select.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ||
    null
  );
}

function applySelectOption(select: HTMLSelectElement, option: HTMLOptionElement): string {
  select.value = option.value;
  option.selected = true;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return optionLabel(option) || option.value;
}

/**
 * Narrow a long native list the way typing narrows a search box: keep the options
 * containing the value's first words, adding a word while more than JEV_LIST_MAX
 * remain. A word that empties the list is backed out.
 */
function narrowByWords(options: HTMLOptionElement[], value: string): HTMLOptionElement[] {
  const words = normalize(value).split(" ").filter(Boolean);
  let shown = options;
  for (let i = 0; i < words.length && shown.length > JEV_LIST_MAX; i += 1) {
    const typed = words.slice(0, i + 1).join(" ");
    const next = shown.filter((option) => normalize(optionLabel(option)).includes(typed));
    if (!next.length) break;
    shown = next;
  }
  return shown;
}

/** Fill a native <select> from its <option> list — not via ARIA listbox scraping. */
export async function fillNativeSelect(select: HTMLSelectElement, value: string): Promise<string> {
  const intended = value.trim();
  const options = realOptions(select);
  const local = options.find((option) => labelsMatch(intended, option));
  if (local) return applySelectOption(select, local);

  if (options.length) {
    const labels = narrowByWords(options, intended).map(optionLabel);
    // A native list is complete, so the SelectorGateway always picks one: the option
    // that means the value, or the closest one an applicant would choose.
    const ai = await askAiMatchOption({
      intendedValue: intended,
      options: labels,
      fieldLabel: fieldLabelFor(select),
      typedQuery: null,
    });
    const matched = ai.matched_option ?? ai.fallback_option;
    const picked = matched
      ? options.find(
          (option) =>
            optionLabel(option) === matched ||
            normalize(optionLabel(option)) === normalize(matched),
        )
      : null;
    if (picked) {
      return applySelectOption(select, picked);
    }
  }

  throw new Error(
    `No select option matching "${value}" (saw: ${options
      .slice(0, 6)
      .map(optionLabel)
      .join(" | ")})`,
  );
}
