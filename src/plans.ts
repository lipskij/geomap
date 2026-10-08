import { API_URL } from "./api";
import { SENSOR_TYPES, type Plan, type Sensor } from "./composables/useSensors";
import { validPos } from "./geo";

// Plan storage. Browser storage (like the alert log) until the backend has
// /api/plans/current; then build with VITE_PLANS_BACKEND=true. The local copy is
// always kept too, so an unreachable server never loses the plan.
const BACKEND = import.meta.env.VITE_PLANS_BACKEND === "true";
const KEY = "geomap.plan";
const PLAN_URL = `${API_URL}/api/plans/current`;

export function loadLocal(): Plan | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parsePlan(raw) : null;
  } catch {
    return null;
  }
}

// Newer plan from the server, if the backend is on
export async function loadRemote(): Promise<Plan | null> {
  if (!BACKEND) return null;
  const res = await fetch(PLAN_URL);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePlan(await res.text());
}

export async function savePlan(plan: Plan): Promise<void> {
  const body = planJson(plan);
  try {
    localStorage.setItem(KEY, body);
  } catch {
    // storage full or blocked: the backend (if on) still gets it
  }
  if (!BACKEND) return;
  const res = await fetch(PLAN_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// File / API format. Radii aren't stored: they come from the sensor type
export function planJson(plan: Plan): string {
  return JSON.stringify(
    {
      version: 1,
      name: plan.name,
      sensors: plan.sensors.map(({ id, type, lat, lng }) => ({ id, type, lat, lng })),
    },
    null,
    2,
  );
}

// Validates untrusted input (imported files, server responses); skips unknown sensor
// types and bad positions
function toSensors(rows: { type?: unknown; lat?: unknown; lng?: unknown }[]): Sensor[] {
  const sensors: Sensor[] = [];
  for (const s of rows) {
    if (!s || typeof s.type !== "string" || !(s.type in SENSOR_TYPES)) continue;
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (!validPos(lat, lng)) continue;
    sensors.push({ id: sensors.length + 1, type: s.type as Sensor["type"], lat, lng });
  }
  return sensors;
}

export function parsePlan(text: string): Plan {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.sensors)) throw new Error("not a sensor plan");
  return {
    name: typeof data.name === "string" ? data.name.slice(0, 100) : "",
    sensors: toSensors(data.sensors),
  };
}

// The CSV deployment list (id,type,lat,lng,range_m); columns found by header name.
// Radii in the file are ignored: they come from the sensor type
export function parsePlanCsv(text: string): Plan {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.trim().toLowerCase());
  const [ti, la, ln] = ["type", "lat", "lng"].map((c) => cols.indexOf(c));
  if (ti < 0 || la < 0 || ln < 0) throw new Error("CSV needs type, lat and lng columns");
  const rows = lines.map((l) => {
    const v = l.split(",").map((c) => c.trim());
    return { type: v[ti], lat: v[la], lng: v[ln] };
  });
  return { name: "", sensors: toSensors(rows) };
}
