// Parses recorded tracks (CSV / GPX / KML) into time-ordered points for replay

export interface ReplayPoint {
  t: number; // ms
  lat: number;
  lng: number;
  alt: number; // m
  speed?: number; // m/s
  rssi?: number;
  pilotLat?: number;
  pilotLng?: number;
}

type RawPoint = Omit<ReplayPoint, "t"> & { t?: number }; // before timestamps are filled in

export interface ReplayTrack {
  id: string;
  points: ReplayPoint[];
}

const num = (v: string | null | undefined) => {
  if (v === null || v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// ISO strings, or unix time in seconds / milliseconds
function parseTime(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : ms;
}

// Points without timestamps are spaced 1 s apart; sort and drop invalid / duplicate times
function finish(
  id: string,
  pts: (RawPoint)[],
): ReplayTrack | null {
  const base = pts.find((p) => p.t !== undefined)?.t ?? Date.now();
  const timed = pts
    .map((p, i) => ({ ...p, t: p.t ?? base + i * 1000 }))
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        !(p.lat === 0 && p.lng === 0),
    )
    .sort((a, b) => a.t - b.t)
    .filter((p, i, arr) => i === 0 || p.t > arr[i - 1].t);
  return timed.length >= 2 ? { id, points: timed } : null;
}

// ---- CSV ----

// RFC 4180: quoted fields may contain commas, quotes ("") and newlines
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const COLUMNS = {
  time: ["time", "timestamp", "datetime", "date"],
  lat: ["drone_lat", "lat", "latitude"],
  lng: ["drone_long", "drone_lng", "lng", "lon", "long", "longitude"],
  alt: [
    "drone_altitude",
    "alt_m",
    "alt",
    "altitude",
    "ele",
    "elevation",
    "height",
  ],
  speedKmh: ["speed_kmh"],
  speed: ["drone_speed", "speed_ms", "speed"],
  rssi: ["rssi_dbm", "rssi"],
  pilotLat: ["pilot_lat"],
  pilotLng: ["pilot_long", "pilot_lng", "pilot_lon"],
  id: ["basic_id", "id"],
  mac: ["mac"],
};

function parseCsv(text: string, fallbackId: string): ReplayTrack[] {
  const [header, ...rows] = parseCsvRows(text);
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  const col = (key: keyof typeof COLUMNS) => {
    for (const alias of COLUMNS[key]) {
      const i = names.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = Object.fromEntries(
    Object.keys(COLUMNS).map((k) => [k, col(k as keyof typeof COLUMNS)]),
  );
  if (c.lat < 0 || c.lng < 0)
    throw new Error("CSV needs latitude and longitude columns");
  const get = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);

  // Several drones per file are grouped by basic_id (or MAC)
  const groups = new Map<string, (RawPoint)[]>();
  for (const r of rows) {
    const id = get(r, c.id)?.trim() || get(r, c.mac)?.trim() || fallbackId;
    const kmh = num(get(r, c.speedKmh));
    const point = {
      t: parseTime(get(r, c.time)),
      lat: num(get(r, c.lat)) ?? NaN,
      lng: num(get(r, c.lng)) ?? NaN,
      alt: num(get(r, c.alt)) ?? 0,
      speed: kmh !== undefined ? kmh / 3.6 : num(get(r, c.speed)),
      rssi: num(get(r, c.rssi)),
      pilotLat: num(get(r, c.pilotLat)),
      pilotLng: num(get(r, c.pilotLng)),
    };
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(point);
  }
  return [...groups]
    .map(([id, pts]) => finish(id, pts))
    .filter((t): t is ReplayTrack => !!t);
}

// ---- GPX ----

function parseGpx(doc: Document, fallbackId: string): ReplayTrack[] {
  return Array.from(doc.getElementsByTagName("trk"))
    .map((trk, i) => {
      const name = trk.getElementsByTagName("name")[0]?.textContent?.trim();
      const pts = Array.from(trk.getElementsByTagName("trkpt")).map((p) => ({
        t: parseTime(p.getElementsByTagName("time")[0]?.textContent),
        lat: num(p.getAttribute("lat")) ?? NaN,
        lng: num(p.getAttribute("lon")) ?? NaN,
        alt: num(p.getElementsByTagName("ele")[0]?.textContent) ?? 0,
      }));
      return finish(name || (i ? `${fallbackId}-${i + 1}` : fallbackId), pts);
    })
    .filter((t): t is ReplayTrack => !!t);
}

// ---- KML ----

function parseKml(doc: Document, fallbackId: string): ReplayTrack[] {
  return Array.from(doc.getElementsByTagName("Placemark"))
    .map((pm, i) => {
      const name = pm.getElementsByTagName("name")[0]?.textContent?.trim();
      const id = name || (i ? `${fallbackId}-${i + 1}` : fallbackId);

      // Google Earth track: <when> + <gx:coord>
      const whens = Array.from(pm.getElementsByTagName("when"));
      const coords = Array.from(pm.getElementsByTagName("gx:coord"));
      if (whens.length && whens.length === coords.length) {
        return finish(
          id,
          coords.map((el, k) => {
            const [lng, lat, alt] = (el.textContent ?? "")
              .trim()
              .split(/\s+/)
              .map(Number);
            return {
              t: parseTime(whens[k].textContent),
              lat,
              lng,
              alt: alt || 0,
            };
          }),
        );
      }

      // LineString, optionally with a TimeSpan (times spread evenly, as in our own export)
      const line = pm
        .getElementsByTagName("LineString")[0]
        ?.getElementsByTagName("coordinates")[0];
      if (!line) return null;
      const tuples = (line.textContent ?? "")
        .trim()
        .split(/\s+/)
        .map((s) => s.split(",").map(Number));
      const begin = parseTime(pm.getElementsByTagName("begin")[0]?.textContent);
      const end = parseTime(pm.getElementsByTagName("end")[0]?.textContent);
      const step =
        begin !== undefined && end !== undefined && tuples.length > 1
          ? (end - begin) / (tuples.length - 1)
          : undefined;
      return finish(
        id,
        tuples.map(([lng, lat, alt], k) => ({
          t:
            begin !== undefined && step !== undefined
              ? begin + k * step
              : undefined,
          lat,
          lng,
          alt: alt || 0,
        })),
      );
    })
    .filter((t): t is ReplayTrack => !!t);
}

// ---- Entry ----

export async function parseTrackFile(file: File): Promise<ReplayTrack[]> {
  const text = await file.text();
  const ext = file.name.split(".").pop()?.toLowerCase();
  // Our own exports are named "<id>_<date>.<ext>": reuse the id
  const fallbackId = file.name.replace(/\.[^.]+$/, "").split("_")[0] || "track";

  let tracks: ReplayTrack[];
  if (ext === "csv") tracks = parseCsv(text, fallbackId);
  else if (ext === "gpx" || ext === "kml") {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      throw new Error("Invalid XML");
    tracks =
      ext === "gpx" ? parseGpx(doc, fallbackId) : parseKml(doc, fallbackId);
  } else throw new Error("Unsupported file type (use CSV, GPX or KML)");

  if (!tracks.length)
    throw new Error("No track with at least 2 positions found");
  return tracks;
}
