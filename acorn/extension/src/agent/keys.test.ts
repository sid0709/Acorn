import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { charKey, chordEvents, keySequenceEvents } from "./keys.ts";

describe("chordEvents", () => {
  it("presses and releases a named key", () => {
    const events = chordEvents("Enter");
    assert.deepEqual(
      events.map((event) => [event.type, event.key]),
      [
        ["keyDown", "Enter"],
        ["keyUp", "Enter"],
      ],
    );
    assert.equal(events[0].text, "\r");
    assert.equal(events[0].windowsVirtualKeyCode, 13);
  });

  it("understands the names a person or a model would use", () => {
    assert.equal(chordEvents("esc")[0].key, "Escape");
    assert.equal(chordEvents("Down")[0].key, "ArrowDown");
    assert.equal(chordEvents("space")[0].text, " ");
    assert.equal(chordEvents("Backspace")[0].type, "rawKeyDown");
  });

  it("types a letter with its own code and text", () => {
    const [down] = chordEvents("a");
    assert.deepEqual(
      [down.key, down.code, down.windowsVirtualKeyCode, down.text],
      ["a", "KeyA", 65, "a"],
    );
    assert.equal(chordEvents("7")[0].code, "Digit7");
  });

  it("holds modifiers around the key and lets go in reverse", () => {
    const events = chordEvents("Control+Shift+Tab");
    assert.deepEqual(
      events.map((event) => `${event.type}:${event.key}:${event.modifiers}`),
      [
        "rawKeyDown:Control:2",
        "rawKeyDown:Shift:10",
        "rawKeyDown:Tab:10",
        "keyUp:Tab:10",
        "keyUp:Shift:2",
        "keyUp:Control:0",
      ],
    );
  });

  it("runs a shortcut as an editing command and types nothing", () => {
    for (const chord of ["Control+a", "Meta+a", "cmd+A"]) {
      const key = chordEvents(chord).find((event) => event.key.toLowerCase() === "a");
      assert.deepEqual(key?.commands, ["selectAll"], chord);
      assert.equal(key?.text, undefined, chord);
    }
    assert.deepEqual(chordEvents("Control+v").find((event) => event.key === "v")?.commands, [
      "paste",
    ]);
  });

  it("types a shifted letter in capitals", () => {
    assert.equal(chordEvents("Shift+a")[1].text, "A");
  });

  it("takes plus as a key", () => {
    assert.equal(chordEvents("+")[0].key, "+");
    assert.equal(chordEvents("Control++")[1].key, "+");
  });

  it("refuses what it cannot press", () => {
    assert.throws(() => chordEvents("Hyper+a"), /not a modifier/);
    assert.throws(() => chordEvents("NotAKey"), /not a key/);
    assert.throws(() => chordEvents(""), /not a key/);
  });
});

describe("charKey", () => {
  it("gives punctuation its own key code, not its code point", () => {
    // "." is code point 46, which is the Delete key: a page would hear Delete, not a period.
    assert.deepEqual([charKey(".").code, charKey(".").keyCode], ["Period", 190]);
    assert.deepEqual([charKey("@").code, charKey("@").keyCode], ["Digit2", 50]);
    assert.deepEqual([charKey("-").code, charKey("-").keyCode], ["Minus", 189]);
    assert.deepEqual([charKey(" ").code, charKey(" ").keyCode], ["Space", 32]);
    assert.equal(charKey("\\").keyCode, 220);
  });

  it("covers every printable ASCII character with a key code that is not a control key", () => {
    for (let code = 0x20; code <= 0x7e; code += 1) {
      const info = charKey(String.fromCharCode(code));
      assert.equal(info.text, String.fromCharCode(code));
      assert.ok(
        info.keyCode >= 32 && info.keyCode !== 46 && info.keyCode !== 127,
        String.fromCharCode(code),
      );
      assert.notEqual(info.code, "", String.fromCharCode(code));
    }
  });

  it("types what has no key of its own without a key code", () => {
    assert.deepEqual([charKey("é").keyCode, charKey("é").code], [0, ""]);
  });
});

describe("keySequenceEvents", () => {
  it("presses each chord in turn", () => {
    const events = keySequenceEvents("Tab  Tab Enter");
    assert.equal(events.filter((event) => event.type === "keyUp").length, 3);
    assert.deepEqual(
      events.filter((event) => event.type !== "keyUp").map((event) => event.key),
      ["Tab", "Tab", "Enter"],
    );
  });

  it("needs a key", () => {
    assert.throws(() => keySequenceEvents("   "), /no key/);
  });
});
