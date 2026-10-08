// Line-of-sight sanity check: node scripts/coverage-check.ts
import assert from "node:assert/strict";
import { lineOfSight } from "../src/coverage.ts";

const M_PER_DEG = 111_320;
const c = { lat: 55, lng: 24, range: 1000 };
const mLng = M_PER_DEG * Math.cos((55 * Math.PI) / 180);
// Flat at 100 m with a 60 m high ridge 200–240 m north of the sensor
const ridge = (lat: number) => {
  const north = (lat - c.lat) * M_PER_DEG;
  return north >= 200 && north <= 240 ? 160 : 100;
};
const sees = lineOfSight(c, ridge, mLng);
assert.equal(sees(0, 100), true, "in front of the ridge");
assert.equal(sees(0, 500), false, "behind the ridge");
assert.equal(sees(0, -500), true, "other side, flat");
assert.equal(sees(500, 0), true, "east, flat");
// Unknown terrain counts as visible
assert.equal(lineOfSight(c, () => NaN, mLng)(0, 500), true);
// A tall enough mount (100 m, e.g. a tower on a hill) sees over the 60 m ridge
assert.equal(lineOfSight({ ...c, mastM: 100 }, ridge, mLng)(0, 500), true, "tall mast");
// Earth curvature: over flat ground a 3 m mast sees a drone 30 m up to ≈ 29.7 km away
const far = lineOfSight({ ...c, range: 35_000 }, () => 0, mLng);
assert.equal(far(0, 25_000), true, "before the horizon");
assert.equal(far(0, 32_000), false, "past the horizon");
console.log("coverage ok");
