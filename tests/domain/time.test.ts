import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Settings } from "luxon";
import { parseToUtcIso } from "../../src/domain/time.js";
import { evaluateSlot } from "../../src/domain/rules.js";

const NOW = new Date("2026-11-18T15:00:00.000Z");

describe("timestamps without an offset", () => {
  const original = Settings.defaultZone;
  beforeEach(() => {
    // A serverless host runs in UTC, not in the clinic's time zone.
    Settings.defaultZone = "UTC";
  });
  afterEach(() => {
    Settings.defaultZone = original;
  });

  test("are read as clinic time (America/Chicago), not server time", () => {
    // 10:00 AM Central on 2026-12-01 (CST, UTC-6) is 16:00 UTC.
    expect(parseToUtcIso("2026-12-01T10:00:00")).toBe("2026-12-01T16:00:00Z");
  });

  test("an explicit offset still wins", () => {
    expect(parseToUtcIso("2026-12-01T10:00:00-06:00")).toBe("2026-12-01T16:00:00Z");
    expect(parseToUtcIso("2026-12-01T16:00:00Z")).toBe("2026-12-01T16:00:00Z");
  });

  test("a naive 10:00 slot is bookable during opening hours", () => {
    const check = evaluateSlot("2026-12-01T10:00:00", NOW, new Set());
    expect(check).toEqual({ ok: true, start: "2026-12-01T16:00:00Z", end: "2026-12-01T16:30:00Z" });
  });
});
