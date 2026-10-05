import type { TrackPoint } from "./composables/useTrackHistory";
import type { Alert } from "./composables/useToasts";

export type ExportFormat = "gpx" | "kml" | "csv";

const iso = (t: number) => new Date(t * 1000).toISOString();
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-secure contexts (plain http on LAN)
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function toGpx(id: string, pts: TrackPoint[]): string {
  const seg = pts
    .map(
      (p) =>
        `      <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.alt}</ele><time>${iso(p.t)}</time></trkpt>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GeoMap" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(id)}</name>
    <trkseg>
${seg}
    </trkseg>
  </trk>
</gpx>
`;
}

function toKml(id: string, pts: TrackPoint[]): string {
  const coords = pts.map((p) => `${p.lng},${p.lat},${p.alt}`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(id)}</name>
    <Placemark>
      <name>${esc(id)}</name>
      <TimeSpan><begin>${iso(pts[0].t)}</begin><end>${iso(pts[pts.length - 1].t)}</end></TimeSpan>
      <LineString>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`;
}

function toCsv(_id: string, pts: TrackPoint[]): string {
  const rows = pts.map((p) =>
    [
      iso(p.t),
      p.lat,
      p.lng,
      p.alt,
      (p.speed * 3.6).toFixed(1),
      p.rssi,
      p.pilotLat,
      p.pilotLng,
    ].join(","),
  );
  return ["time,lat,lng,alt_m,speed_kmh,rssi_dbm,pilot_lat,pilot_long", ...rows].join("\n") + "\n";
}

const MIME: Record<ExportFormat, string> = {
  gpx: "application/gpx+xml",
  kml: "application/vnd.google-earth.kml+xml",
  csv: "text/csv",
};

export function exportTrack(
  id: string,
  pts: TrackPoint[],
  format: ExportFormat,
): void {
  if (!pts.length) return;
  const body = { gpx: toGpx, kml: toKml, csv: toCsv }[format](id, pts);
  download(
    `${id}_${fileTime(pts[0].t)}.${format}`,
    body,
    MIME[format],
  );
}

const fileTime = (t: number) => iso(t).slice(0, 19).replace(/[:T]/g, "-");

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Alert log as CSV (times in ms); fields quoted since zone names may contain commas
export function exportAlerts(alerts: Alert[]): void {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = alerts.map((a) =>
    [iso(a.time / 1000), a.kind, q(a.droneId), q(a.text)].join(","),
  );
  download(
    `alerts_${fileTime(Date.now() / 1000)}.csv`,
    ["time,kind,drone_id,message", ...rows].join("\n") + "\n",
    MIME.csv,
  );
}
