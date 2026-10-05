import type { TrackPoint } from "./composables/useTrackHistory";

export type ExportFormat = "gpx" | "kml" | "csv";

const iso = (t: number) => new Date(t * 1000).toISOString();
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

function toCsv(pts: TrackPoint[]): string {
  const rows = pts.map((p) =>
    [iso(p.t), p.lat, p.lng, p.alt, (p.speed * 3.6).toFixed(1), p.rssi].join(
      ",",
    ),
  );
  return ["time,lat,lng,alt_m,speed_kmh,rssi_dbm", ...rows].join("\n") + "\n";
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
  const body =
    format === "gpx"
      ? toGpx(id, pts)
      : format === "kml"
        ? toKml(id, pts)
        : toCsv(pts);
  const url = URL.createObjectURL(new Blob([body], { type: MIME[format] }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${id}_${iso(pts[0].t).slice(0, 19).replace(/[:T]/g, "-")}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
