// Drone zones from the ANS UTM map API (GeoJSON with ED-269 style properties)

import { bboxOf, inPolygon, type BBox, type Rings } from "./geo";
import {
  matchPlan,
  planName,
  type OperationPlan,
  type PlanMatch,
} from "./plans";

export type Restriction = "PROHIBITED" | "REQ_AUTHORISATION" | "NO_RESTRICTION";

export interface Zone {
  id: string;
  name: string;
  restriction: Restriction;
  reason: string;
  message: string;
  lowerM: number; // m above ground
  upperM: number; // m above ground
  lowerText: string;
  upperText: string;
  temporary: boolean;
  applicability: Applicability[];
  rings: Rings;
  bbox: BBox;
}

interface Schedule {
  day: string[];
  startTime: string; // "06:00Z"
  endTime: string;
}

interface Applicability {
  permanent: "YES" | "NO";
  startDateTime?: string;
  endDateTime?: string;
  schedule?: Schedule[];
}

export type CheckLevel = "ok" | "authorised" | "info" | "warn" | "alert";

export interface ZoneCheck {
  level: CheckLevel;
  label: string; // short summary of the most severe issue
  zones: Zone[]; // zones the drone is inside (horizontally and vertically)
  aboveMax: boolean;
  plan?: PlanMatch; // approved flight plan the drone is flying inside
}

export const RESTRICTION_LABEL: Record<Restriction, string> = {
  PROHIBITED: "Prohibited",
  REQ_AUTHORISATION: "Authorisation required",
  NO_RESTRICTION: "Information",
};

// Short form for list badges
const SHORT_LABEL: Record<Restriction, string> = {
  PROHIBITED: "Prohibited",
  REQ_AUTHORISATION: "Authorisation",
  NO_RESTRICTION: "Info",
};

const LEVEL: Record<Restriction, CheckLevel> = {
  PROHIBITED: "alert",
  REQ_AUTHORISATION: "warn",
  NO_RESTRICTION: "info",
};
const RANK: Record<CheckLevel, number> = {
  ok: 0,
  authorised: 0,
  info: 1,
  warn: 2,
  alert: 3,
};

// ---- Parsing ----

// Their messages contain HTML; keep plain text only
function toText(html: string): string {
  return (
    new DOMParser()
      .parseFromString(html, "text/html")
      .body.textContent?.trim() ?? ""
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseZone(f: any): Zone | null {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (p.hidden || !g || g.type !== "Polygon") return null;
  const rings: Rings = g.coordinates;
  const en = p.extendedProperties?.localizedMessages?.find(
    (m: { language: string }) => m.language === "en-GB",
  )?.message;
  const applicability: Applicability[] = p.applicability ?? [
    { permanent: "YES" },
  ];
  return {
    id: p.identifier ?? p.name,
    name: p.name ?? p.identifier,
    restriction: p.restriction,
    reason: p.reason ?? "",
    message: toText(en ?? p.message ?? ""),
    lowerM: Number(p.lowerMeters ?? 0),
    upperM: Number(p.upperMeters ?? Infinity),
    lowerText: p.lower ?? `${p.lowerMeters} M AGL`,
    upperText: p.upper ?? `${p.upperMeters} M AGL`,
    temporary: applicability.every((a) => a.permanent !== "YES"),
    applicability,
    rings,
    bbox: bboxOf(rings),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseZones(geojson: any): Zone[] {
  return (geojson.features ?? [])
    .map(parseZone)
    .filter((z: Zone | null): z is Zone => !!z);
}

// ---- Time ----

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.replace("Z", "").split(":").map(Number);
  return h * 60 + m;
};

function scheduleActive(s: Schedule, now: Date): boolean {
  const day = DAYS[now.getUTCDay()];
  if (!s.day.includes("ANY") && !s.day.includes(day)) return false;
  const t = now.getUTCHours() * 60 + now.getUTCMinutes();
  const start = minutes(s.startTime);
  const end = minutes(s.endTime);
  return start <= end ? t >= start && t <= end : t >= start || t <= end; // overnight
}

export function isZoneActive(z: Zone, now = new Date()): boolean {
  return z.applicability.some((a) => {
    if (a.permanent !== "YES") {
      if (a.startDateTime && now < new Date(a.startDateTime)) return false;
      if (a.endDateTime && now > new Date(a.endDateTime)) return false;
    }
    return (
      !a.schedule?.length || a.schedule.some((s) => scheduleActive(s, now))
    );
  });
}

// ---- Check ----

// altM is treated as height above ground (zone limits are AGL).
// plans: approved-plan data, or null when it isn't available (then no "No plan" wording).
export function checkPosition(
  lat: number,
  lng: number,
  altM: number,
  zones: Zone[],
  maxAltM: number,
  plans: OperationPlan[] | null = null,
): ZoneCheck {
  const hits = zones
    .filter(
      (z) =>
        inPolygon(lng, lat, z.rings, z.bbox) &&
        altM >= z.lowerM &&
        altM <= z.upperM,
    )
    .sort((a, b) => RANK[LEVEL[b.restriction]] - RANK[LEVEL[a.restriction]]);
  const aboveMax = altM > maxAltM;
  const plan = plans ? matchPlan(lat, lng, altM, plans) : undefined;

  // Inside an approved plan (area, time and height): treat as authorised
  if (plan) {
    return {
      level: "authorised",
      label: `Approved plan · ${planName(plan.plan)}`,
      zones: hits,
      aboveMax,
      plan,
    };
  }

  let level: CheckLevel = "ok";
  let label = "No zone";
  if (hits.length) {
    const top = hits[0];
    level = LEVEL[top.restriction];
    const prefix =
      top.restriction === "REQ_AUTHORISATION" && plans
        ? "No plan"
        : SHORT_LABEL[top.restriction];
    label = `${prefix} · ${top.name}`;
  }
  if (aboveMax && RANK[level] < RANK.warn) {
    level = "warn";
    label = `Above ${maxAltM} m`;
  }
  return { level, label, zones: hits, aboveMax };
}
