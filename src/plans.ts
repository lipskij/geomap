// Approved flight plans (operation plans) from the ANS UTM map API

import { bboxOf, inPolygon, type BBox, type Rings } from "./geo";

export interface PlanVolume {
  rings: Rings;
  bbox: BBox;
  begin: number; // ms
  end: number; // ms
  minM: number; // m above ground
  maxM: number; // m above ground
  bvlos: boolean;
}

export interface OperationPlan {
  id: string;
  title: string; // "" when the plan has no readable title
  state: string; // PROPOSED | AUTHORIZED | ACTIVATED | ...
  approved: boolean;
  mode: string; // e.g. REMOTELY_PILOTED_VLOS
  volumes: PlanVolume[];
}

export interface PlanMatch {
  plan: OperationPlan;
  volume: PlanVolume;
}

const APPROVED_STATES = ["AUTHORIZED", "ACTIVATED"];

export const STATE_LABEL: Record<string, string> = {
  PROPOSED: "Proposed",
  AUTHORIZED: "Authorised",
  ACTIVATED: "Activated (flying)",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Altitude {
  altitudeValue: number;
  unitsOfMeasure?: string;
}
const toMeters = (a?: Altitude) =>
  a
    ? Math.round(
        (a.unitsOfMeasure === "FT"
          ? a.altitudeValue * 0.3048
          : a.altitudeValue) * 10,
      ) / 10
    : 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePlan(f: any): OperationPlan | null {
  const p = f.properties ?? {};
  const op = p.originalPlan;
  if (!op?.operationVolumes?.length) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumes: PlanVolume[] = op.operationVolumes.flatMap((v: any) => {
    const g = v.operationGeometry?.geom;
    if (g?.type !== "Polygon") return [];
    return [
      {
        rings: g.coordinates,
        bbox: bboxOf(g.coordinates),
        begin: Date.parse(v.timeBegin),
        end: Date.parse(v.timeEnd),
        minM: toMeters(v.operationGeometry.minAltitude),
        maxM: toMeters(v.operationGeometry.maxAltitude),
        bvlos: !!v.isBVLOS,
      },
    ];
  });
  if (!volumes.length) return null;

  const id: string = p.id ?? op.operationPlanId;
  const rawTitle: string = op.publicInfo?.title ?? p.name ?? "";
  const state: string = p.state ?? op.state ?? "";
  return {
    id,
    title: UUID.test(rawTitle) || rawTitle === id ? "" : rawTitle,
    state,
    approved: APPROVED_STATES.includes(state),
    mode: op.modeOfOperation ?? "",
    volumes,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePlans(geojson: any): OperationPlan[] {
  return (geojson.features ?? [])
    .map(parsePlan)
    .filter((p: OperationPlan | null): p is OperationPlan => !!p);
}

export const planName = (p: OperationPlan) =>
  p.title || `Plan ${p.id.slice(0, 8)}`;

export function activeVolumes(
  p: OperationPlan,
  now = Date.now(),
): PlanVolume[] {
  return p.volumes.filter((v) => now >= v.begin && now <= v.end);
}

export const isPlanActive = (p: OperationPlan, now = Date.now()) =>
  activeVolumes(p, now).length > 0;

// First approved plan whose active volume contains the position (area, time and height)
export function matchPlan(
  lat: number,
  lng: number,
  altM: number,
  plans: OperationPlan[],
  now = Date.now(),
): PlanMatch | undefined {
  for (const plan of plans) {
    if (!plan.approved) continue;
    for (const volume of activeVolumes(plan, now)) {
      if (
        altM >= volume.minM &&
        altM <= volume.maxM &&
        inPolygon(lng, lat, volume.rings, volume.bbox)
      ) {
        return { plan, volume };
      }
    }
  }
  return undefined;
}
