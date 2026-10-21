import { describe, expect, test } from "bun:test";
import { formatTime } from "./dates";

describe("a time of day", () => {
  test("reads from minutes after midnight on a 12-hour clock", () => {
    expect(formatTime(0)).toBe("12:00 AM");
    expect(formatTime(5)).toBe("12:05 AM");
    expect(formatTime(9 * 60 + 30)).toBe("9:30 AM");
    expect(formatTime(12 * 60)).toBe("12:00 PM");
    expect(formatTime(15 * 60 + 42)).toBe("3:42 PM");
    expect(formatTime(23 * 60 + 59)).toBe("11:59 PM");
  });
});
