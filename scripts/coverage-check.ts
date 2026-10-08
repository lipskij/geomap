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
console.log("coverage ok");
