import { describe, expect, it } from "vitest";
import { distanceKm, hasSignal, nearWaypoint, SILENT_AFTER_MS } from "./fleet";

const now = Date.parse("2026-11-27T12:00:00Z");
const ping = (msAgo: number) => ({
  latitude: 42.7,
  longitude: 23.3,
  accuracy: null,
  speed: 80,
  heading: null,
  recordedAt: new Date(now - msAgo).toISOString(),
});
const tracker = (status: string) => ({
  assignmentId: "a",
  assignedAt: "",
  id: "t",
  serialNumber: "1",
  provider: "flespi",
  batteryLevel: 80,
  lastSeenAt: null,
  status,
});

describe("hasSignal", () => {
  it("is live after a recent ping", () => {
    expect(
      hasSignal({ current: ping(60_000), tracker: tracker("ASSIGNED") }, now),
    ).toBe(true);
  });
  it("is silent with no ping, an old ping or an offline tracker", () => {
    expect(
      hasSignal({ current: null, tracker: tracker("ASSIGNED") }, now),
    ).toBe(false);
    expect(
      hasSignal(
        { current: ping(SILENT_AFTER_MS + 1), tracker: tracker("ASSIGNED") },
        now,
      ),
    ).toBe(false);
    expect(
      hasSignal({ current: ping(60_000), tracker: tracker("OFFLINE") }, now),
    ).toBe(false);
  });
});

describe("nearWaypoint", () => {
  const route = [
    { label: "London", latitude: 51.5, longitude: -0.12 },
    { label: "Sofia", latitude: 42.69, longitude: 23.32 },
  ];
  it("names the closest stop within range", () => {
    expect(nearWaypoint({ latitude: 42.5, longitude: 23.1 }, route)).toBe(
      "Sofia",
    );
  });
  it("names nothing when every stop is far away", () => {
    expect(nearWaypoint({ latitude: 35.1, longitude: 33.4 }, route)).toBeNull();
  });
  it("measures London to Sofia at about 2,000 km", () => {
    expect(Math.round(distanceKm(route[0], route[1]) / 100)).toBe(20);
  });
});
