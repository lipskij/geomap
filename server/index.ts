// Read-only detections API: GET /api/detections returns the latest frame per drone
// seen in the last STALE_SECONDS, in the receiver's JSON format plus `received`.
// Sources (either or both, by env):
//   Postgres: PGHOST, PGUSER, PGPASSWORD, PGDATABASE (table in schema.sql)
//   MQTT:     MQTT_URL, MQTT_TOPIC (each message = one receiver JSON frame)
// Run: npm start (reads .env)
import { createServer } from "node:http";
import pg from "pg";
import mqtt from "mqtt";

const PORT = Number(process.env.PORT ?? 8000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const STALE_SECONDS = 60; // same as the app's STALE_SECONDS

type Frame = Record<string, unknown> & { "uav id": string; received: number };

const db = process.env.PGHOST ? new pg.Pool() : null;

async function fromDb(): Promise<Frame[]> {
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (frame->>'uav id') frame, extract(epoch FROM received)::float8 AS received
     FROM detections
     WHERE received > now() - make_interval(secs => $1)
     ORDER BY frame->>'uav id', received DESC`,
    [STALE_SECONDS],
  );
  return rows.map((r) => ({ ...r.frame, received: r.received }));
}

// ponytail: latest frames live in memory only; a restart forgets drones until their next frame
const live = new Map<string, Frame>();
if (process.env.MQTT_URL) {
  const client = mqtt.connect(process.env.MQTT_URL);
  client.on("connect", () => client.subscribe(process.env.MQTT_TOPIC ?? "#"));
  client.on("error", (e) => console.error("mqtt:", e.message));
  client.on("message", (_topic, payload) => {
    try {
      const f = JSON.parse(payload.toString());
      if (typeof f?.["uav id"] === "string") live.set(f["uav id"], { ...f, received: Date.now() / 1000 });
    } catch {
      // not a JSON frame: ignore
    }
  });
}

function fromMqtt(): Frame[] {
  const cutoff = Date.now() / 1000 - STALE_SECONDS;
  for (const [id, f] of live) if (f.received < cutoff) live.delete(id);
  return [...live.values()];
}

// Both sources on: the newer frame per drone wins
async function detections(): Promise<Frame[]> {
  const byId = new Map<string, Frame>();
  for (const f of [...(await fromDb()), ...fromMqtt()]) {
    const prev = byId.get(f["uav id"]);
    if (!prev || f.received > prev.received) byId.set(f["uav id"], f);
  }
  return [...byId.values()];
}

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  if (req.method !== "GET" || req.url?.split("?")[0] !== "/api/detections") {
    res.writeHead(req.method === "GET" ? 404 : 405).end();
    return;
  }
  try {
    const body = JSON.stringify(await detections());
    res.writeHead(200, { "Content-Type": "application/json" }).end(body);
  } catch (e) {
    console.error("db:", (e as Error).message);
    res.writeHead(502).end();
  }
}).listen(PORT, () =>
  console.log(`detections API on :${PORT} (db: ${!!db}, mqtt: ${!!process.env.MQTT_URL})`),
);
