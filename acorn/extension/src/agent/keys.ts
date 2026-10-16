/**
 * Key names the agent sends ("Enter", "Control+a", "ArrowDown") turned into the key events
 * the browser's own input protocol takes. A chord presses its modifiers, then the key, then
 * lets go in reverse, as a person's hands do.
 */

/** Modifier bits of the DevTools protocol's Input.dispatchKeyEvent. */
const MODIFIER_BIT = { alt: 1, control: 2, meta: 4, shift: 8 } as const;

type Modifier = keyof typeof MODIFIER_BIT;

const MODIFIER_ALIASES: Record<string, Modifier> = {
  alt: "alt",
  option: "alt",
  control: "control",
  ctrl: "control",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  shift: "shift",
};

/** One key's identity: what the page sees as key, code, and legacy key code. */
type KeyInfo = { key: string; code: string; keyCode: number; text?: string };

const NAMED_KEYS: Record<string, KeyInfo> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  del: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

/** Editing commands a shortcut runs. A browser on macOS runs them as commands, not as keys. */
const SHORTCUT_COMMANDS: Record<string, string> = {
  a: "selectAll",
  c: "copy",
  v: "paste",
  x: "cut",
  z: "undo",
};

/** One event for the protocol. */
export type KeyEvent = {
  type: "keyDown" | "rawKeyDown" | "keyUp";
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
  commands?: string[];
};

/**
 * Punctuation on a US keyboard: the key code and physical key each character is typed with.
 * A character's own code point is not its key code ("." is 46, which is the Delete key), so
 * a page that reads key codes would otherwise hear the wrong key.
 */
const PUNCTUATION_KEYS: Record<string, { code: string; keyCode: number }> = {
  " ": { code: "Space", keyCode: 32 },
  "`": { code: "Backquote", keyCode: 192 },
  "~": { code: "Backquote", keyCode: 192 },
  "-": { code: "Minus", keyCode: 189 },
  _: { code: "Minus", keyCode: 189 },
  "=": { code: "Equal", keyCode: 187 },
  "+": { code: "Equal", keyCode: 187 },
  "[": { code: "BracketLeft", keyCode: 219 },
  "{": { code: "BracketLeft", keyCode: 219 },
  "]": { code: "BracketRight", keyCode: 221 },
  "}": { code: "BracketRight", keyCode: 221 },
  "\\": { code: "Backslash", keyCode: 220 },
  "|": { code: "Backslash", keyCode: 220 },
  ";": { code: "Semicolon", keyCode: 186 },
  ":": { code: "Semicolon", keyCode: 186 },
  "'": { code: "Quote", keyCode: 222 },
  '"': { code: "Quote", keyCode: 222 },
  ",": { code: "Comma", keyCode: 188 },
  "<": { code: "Comma", keyCode: 188 },
  ".": { code: "Period", keyCode: 190 },
  ">": { code: "Period", keyCode: 190 },
  "/": { code: "Slash", keyCode: 191 },
  "?": { code: "Slash", keyCode: 191 },
  // The shifted digits of the number row.
  "!": { code: "Digit1", keyCode: 49 },
  "@": { code: "Digit2", keyCode: 50 },
  "#": { code: "Digit3", keyCode: 51 },
  $: { code: "Digit4", keyCode: 52 },
  "%": { code: "Digit5", keyCode: 53 },
  "^": { code: "Digit6", keyCode: 54 },
  "&": { code: "Digit7", keyCode: 55 },
  "*": { code: "Digit8", keyCode: 56 },
  "(": { code: "Digit9", keyCode: 57 },
  ")": { code: "Digit0", keyCode: 48 },
};

/** The key info of one printable character, as a US keyboard would type it. */
export function charKey(char: string): KeyInfo {
  const upper = char.toUpperCase();
  if (/^[a-z]$/i.test(char)) {
    return { key: char, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: char };
  }
  if (/^[0-9]$/.test(char)) {
    return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char };
  }
  const punctuation = PUNCTUATION_KEYS[char];
  if (punctuation) return { key: char, ...punctuation, text: char };
  // A character with no key of its own (accented, symbolic) is typed without a key code.
  return { key: char, code: "", keyCode: 0, text: char };
}

function keyInfo(name: string): KeyInfo {
  const named = NAMED_KEYS[name.toLowerCase()];
  if (named) return named;
  if ([...name].length === 1) return charKey(name);
  throw new Error(`"${name}" is not a key the agent can press`);
}

/** Splits "Control+Shift+a" into its modifiers and its key. "+" is the plus key, alone or last. */
function parseChord(chord: string): { modifiers: Modifier[]; key: string } {
  const plusKey = chord === "+" || chord.endsWith("++");
  const parts = (plusKey ? chord.slice(0, -2) : chord).split("+").filter((part) => part !== "");
  const key = plusKey ? "+" : parts.pop();
  if (!key) throw new Error(`"${chord}" is not a key the agent can press`);
  const modifiers = parts.map((part) => {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier) throw new Error(`"${part}" is not a modifier key`);
    return modifier;
  });
  return { modifiers, key };
}

/** The events that press and release one chord: "Enter", "Control+a", "Shift+Tab". */
export function chordEvents(chord: string): KeyEvent[] {
  const { modifiers, key } = parseChord(chord);
  const info = keyInfo(key);
  const events: KeyEvent[] = [];
  let held = 0;
  const modifierInfo = (
    modifier: Modifier,
  ): Pick<KeyEvent, "key" | "code" | "windowsVirtualKeyCode"> => {
    switch (modifier) {
      case "alt":
        return { key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18 };
      case "control":
        return { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 };
      case "meta":
        return { key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91 };
      case "shift":
        return { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 };
    }
  };
  for (const modifier of modifiers) {
    held |= MODIFIER_BIT[modifier];
    events.push({ type: "rawKeyDown", ...modifierInfo(modifier), modifiers: held });
  }
  // A key held with Control or Meta does not type its character: it runs a shortcut.
  const shortcut = modifiers.includes("control") || modifiers.includes("meta");
  const commands = shortcut ? [SHORTCUT_COMMANDS[key.toLowerCase()]].filter(Boolean) : [];
  const text = shortcut
    ? undefined
    : modifiers.includes("shift") && info.text
      ? info.text.toUpperCase()
      : info.text;
  events.push({
    type: text ? "keyDown" : "rawKeyDown",
    key: info.key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    modifiers: held,
    ...(text ? { text } : {}),
    ...(commands.length ? { commands } : {}),
  });
  events.push({
    type: "keyUp",
    key: info.key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    modifiers: held,
  });
  for (const modifier of [...modifiers].reverse()) {
    held &= ~MODIFIER_BIT[modifier];
    events.push({ type: "keyUp", ...modifierInfo(modifier), modifiers: held });
  }
  return events;
}

/** The events for a space-separated sequence of chords: "Tab Tab Enter". */
export function keySequenceEvents(keys: string): KeyEvent[] {
  const chords = keys.trim().split(/\s+/).filter(Boolean);
  if (chords.length === 0) throw new Error("there is no key to press");
  return chords.flatMap(chordEvents);
}
