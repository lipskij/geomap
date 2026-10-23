import { shallowRef } from "vue";
import type { Bearing } from "./acoustic";
import type { Sensor } from "./composables/useSensors";
import type { Detections } from "./types";
import { t } from "./i18n";

// Backend live feed over a WebSocket: a snapshot on connect, then each message replaces
// one whole track (by track_id) or updates one node. Reconnects after any drop; the new
// snapshot replaces all state
const LIVE_URL = import.meta.env.VITE_LIVE_URL ?? "wss://oracle.danius.cfd:8443/v1/live";
// ponytail: key built into the frontend bundle, visible to anyone who loads the app;
// fine for development, use a per-user token or a backend proxy before production
// No token with a VITE_LIVE_URL of its own: the server sits behind a login (Cloudflare
// Access) and the browser's login cookie authenticates the socket
const TOKEN = import.meta.env.VITE_LIVE_TOKEN ?? "";
const RETRY_MS = 3000; // doubles after each failed connect, up to MAX_RETRY_MS
const MAX_RETRY_MS = 30_000;

interface LiveNode {
  node_id: string;
  lat: number;
  lon: number;
  online: boolean;
  type?: string; // "rid" = Remote ID receiver; anything else = camera scanner (oracle)
  camera?: boolean; // live camera on /v1/camera
}

interface LiveTrack {
  track_id: string;
  kind: "rid" | "contact";
  uas_id?: string;
  state: string; // "lost": not heard lately, shown greyed out
  last_seen: string; // ISO time
  latest?: {
    lat?: number;
    lon?: number;
    alt_geo?: number;
    speed_h?: number; // m/s
    operator_lat?: number;
    operator_lon?: number;
    node_id?: string; // contact: the node that hears it
    bearing_deg?: number | null; // contact: null = heard, direction unknown
    bearing_uncertainty_deg?: number;
    classes?: string[];
  };
  nodes?: Record<string, { rssi: number | null }>;
  visual_confirmed?: boolean;
  audio_confirmed?: boolean;
}

type LiveStatus =
  | "off"
  | "noKey"
  | "connecting"
  | "open"
  | "retrying"
  | "refused" // never got in: wrong key or server down (the browser can't tell which)
  | "badKey";
export const liveStatus = shallowRef<LiveStatus>("off");
export const liveNodes = shallowRef<Sensor[]>([]); // backend nodes as bearing sensors

const tracks = new Map<string, LiveTrack>();
const nodes = new Map<string, LiveNode>();
const nodeIds = new Map<string, number>(); // node_id -> numeric sensor id, stable per session
const alertHandlers: ((t: LiveTrack) => void)[] = [];
let ws: WebSocket | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0; // connects in a row that never opened

export const onContactAlert = (fn: (t: LiveTrack) => void) => alertHandlers.push(fn);

const sensorId = (nodeId: string) => {
  if (!nodeIds.has(nodeId)) nodeIds.set(nodeId, 1001 + nodeIds.size);
  return nodeIds.get(nodeId)!;
};

// Positions for nodes that detect but never send a status (cameras don't report one yet).
// ponytail: hand-placed test values; remove once the nodes send status with lat/lon
const FAKE_NODE_POS: Record<string, { lat: number; lon: number }> = {
  "vln-01": { lat: 54.6862, lon: 25.278 },
};

let nodesKey = "";
function publishNodes() {
  const list: LiveNode[] = [...nodes.values()];
  const used = new Set<string>(); // nodes the tracks mention
  for (const t of tracks.values()) {
    if (t.latest?.node_id) used.add(t.latest.node_id);
    for (const id in t.nodes ?? {}) used.add(id);
  }
  for (const id of used)
    if (!nodes.has(id) && FAKE_NODE_POS[id])
      list.push({ node_id: id, ...FAKE_NODE_POS[id], online: true });
  // Track messages call this every time: only republish when the nodes changed
  const key = JSON.stringify(list);
  if (key === nodesKey) return;
  nodesKey = key;
  liveNodes.value = list.map((n) => ({
    id: sensorId(n.node_id),
    type: n.type === "rid" ? ("rid" as const) : ("video" as const), // oracle scanners: camera bearings
    lat: n.lat,
    lng: n.lon,
    name: n.node_id,
    offline: !n.online,
    camera: n.camera,
  }));
}

function handle(m: { type: string; data?: any; tracks?: LiveTrack[]; nodes?: LiveNode[] }) {
  switch (m.type) {
    case "snapshot":
      tracks.clear();
      nodes.clear();
      for (const t of m.tracks ?? []) tracks.set(t.track_id, t);
      for (const n of m.nodes ?? []) nodes.set(n.node_id, n);
      publishNodes();
      break;
    case "track.created":
    case "track.updated":
    case "track.lost": // merged: in case a lost message carries only the changed fields
      tracks.set(m.data.track_id, { ...tracks.get(m.data.track_id), ...m.data });
      publishNodes(); // a node with a fake position may have just appeared
      break;
    case "track.closed":
      tracks.delete(m.data.track_id);
      break;
    case "contact.alert": // also arrives as track.created, so tracks need nothing here
      for (const fn of alertHandlers) fn(m.data);
      break;
    case "history.deleted":
      pendingDelete?.resolve(m.data.ids);
      pendingDelete = undefined;
      break;
    case "node.status":
      nodes.set(m.data.node_id, { ...nodes.get(m.data.node_id), ...m.data });
      publishNodes();
      break;
  }
}

function connect() {
  if (!TOKEN && !import.meta.env.VITE_LIVE_URL) return void (liveStatus.value = "noKey");
  liveStatus.value = "connecting";
  const sock = new WebSocket(TOKEN ? `${LIVE_URL}?token=${encodeURIComponent(TOKEN)}` : LIVE_URL);
  ws = sock;
  let opened = false;
  sock.onopen = () => {
    opened = true;
    failures = 0;
    liveStatus.value = "open";
  };
  sock.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch {
      // malformed message: skip it, the next snapshot or update corrects state
    }
  };
  sock.onclose = (e) => {
    pendingDelete?.reject(new Error(t("history.notConnected")));
    pendingDelete = undefined;
    if (ws !== sock) return; // switched off or replaced
    if (e.code === 1008) return void (liveStatus.value = "badKey"); // retrying won't help
    // A wrong key is refused at the handshake (HTTP 403), which a browser only sees as
    // close 1006, same as the server being down: keep retrying, but slower each time
    if (!opened) failures++;
    liveStatus.value = opened ? "retrying" : "refused";
    retry = setTimeout(connect, Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** failures));
  };
}

export function setLive(on: boolean) {
  clearTimeout(retry);
  failures = 0;
  const old = ws;
  ws = undefined;
  old?.close();
  tracks.clear();
  nodes.clear();
  nodesKey = "";
  publishNodes();
  if (on) connect();
  else liveStatus.value = "off";
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

// Remote ID tracks in the shape the map and lists already use. Lost tracks keep their
// old last_seen, so the usual age fade greys them out
export function liveDetections(): Detections {
  const out: Detections = {};
  for (const t of tracks.values()) {
    const l = t.latest;
    if (t.kind !== "rid" || l?.lat == null || l.lon == null) continue;
    const rssi = Object.values(t.nodes ?? {})
      .map((n) => n.rssi)
      .filter((r): r is number => r != null);
    const id = t.uas_id ?? t.track_id;
    out[id] = {
      basic_id: id,
      track_id: t.track_id,
      rssi: rssi.length ? Math.max(...rssi) : null,
      drone_lat: l.lat,
      drone_long: l.lon,
      drone_altitude: l.alt_geo ?? 0,
      drone_speed: l.speed_h ?? 0,
      pilot_lat: l.operator_lat ?? 0, // 0,0 = no pilot position (see validPos)
      pilot_long: l.operator_lon ?? 0,
      last_update: seconds(t.last_seen),
      sensors: Object.entries(t.nodes ?? {}).map(([node, n]) => ({ node, rssi: n.rssi })),
      visual: t.visual_confirmed,
      audio: t.audio_confirmed,
    };
  }
  return out;
}

// Contact tracks as bearings from their node. No direction known: a full circle around
// the node (±180°), which flags it on the map but never takes part in a crossing
export function liveBearings(): Bearing[] {
  const out: Bearing[] = [];
  for (const t of tracks.values()) {
    const l = t.latest;
    if (t.kind !== "contact" || t.state === "lost" || !l?.node_id) continue;
    const known = l.bearing_deg != null;
    out.push({
      sensorId: sensorId(l.node_id),
      trackId: t.track_id,
      deg: known ? l.bearing_deg! : 0,
      sigmaDeg: known ? (l.bearing_uncertainty_deg ?? 10) : 180,
      // The backend keeps a contact active until 15 s without events; cameras report
      // every few seconds, so its own last_seen would drop out of the 2 s crossing window
      t: Date.now(),
    });
  }
  return out;
}

// Flight logs kept on the Pi for 30 days (server/rid_server.py). Same origin as the app
// when the Pi serves it; the dev server proxies /v1/history otherwise (vite.config.ts)
export interface HistoryEntry {
  id: string;
  uas_id: string;
  start: string; // ISO time
  end: string;
  points: number;
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const r = await fetch("/v1/history");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // Anything but JSON (e.g. an HTML page): this live server keeps no flight logs
  if (!r.headers.get("content-type")?.includes("json")) throw new Error("No flight history on this server");
  return r.json();
}

// One flight log as a file for replay
export async function historyFile(id: string): Promise<File> {
  const r = await fetch(`/v1/history/${encodeURIComponent(id)}.csv`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new File([await r.text()], `${id}.csv`, { type: "text/csv" });
}

// Deletes flight logs on the Pi over the live socket; resolves with the ids it deleted
let pendingDelete: { resolve: (ids: string[]) => void; reject: (e: Error) => void } | undefined;
export function deleteHistory(ids: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (ws?.readyState !== WebSocket.OPEN) return reject(new Error(t("history.notConnected")));
    pendingDelete = { resolve, reject };
    ws.send(JSON.stringify({ type: "history.delete", ids }));
  });
}

// Live camera of the server's node (server/rid_server.py /v1/camera): calls onFrame with an
// object URL per JPEG, valid until the next one. Every frame is answered, so the server
// never sends more than the link carries. Returns stop.
// ponytail: one camera per server; a node id in the path once a server has several
export function watchCamera(onFrame: (url: string) => void): () => void {
  const url = LIVE_URL.replace(/\/v1\/live$/, "/v1/camera");
  const sock = new WebSocket(TOKEN ? `${url}?token=${encodeURIComponent(TOKEN)}` : url);
  sock.binaryType = "blob";
  let last = "";
  sock.onmessage = (e) => {
    sock.send("1");
    URL.revokeObjectURL(last);
    onFrame((last = URL.createObjectURL(e.data)));
  };
  return () => {
    sock.close();
    URL.revokeObjectURL(last);
  };
}

export interface Snapshot {
  url: string;
  node: string;
  ts: string; // ISO time
}

// Newest camera snapshot per node for a track, through the dev server's /oracle proxy
// (see vite.config.ts). ponytail: dev only until the backend allows CORS and fixes media
// ?token=; it also looks only at the track's latest 200 events
export async function snapshots(trackId: string): Promise<Record<string, Snapshot>> {
  if (!import.meta.env.DEV) return {};
  const res = await fetch(`/oracle/v1/tracks/${encodeURIComponent(trackId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const track: { events?: { event_id: string; type: string; node_id: string; ts: string; media_path: string | null }[] } =
    await res.json();
  const out: Record<string, Snapshot> = {};
  for (const e of track.events ?? []) // newest first: keep the first per node
    if (e.type === "visual" && e.media_path && !out[e.node_id])
      out[e.node_id] = { url: `/oracle/v1/media/${encodeURIComponent(e.event_id)}`, node: e.node_id, ts: e.ts };
  return out;
}

export const newest = (snaps: Record<string, Snapshot>) =>
  Object.values(snaps).sort((a, b) => b.ts.localeCompare(a.ts))[0] ?? null;
