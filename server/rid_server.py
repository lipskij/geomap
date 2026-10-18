"""Remote ID live server for geomap.

Reads JSON lines from an ESP32 Remote ID receiver (USB serial, or stdin for testing)
and serves them as geomap's live feed (see src/live.ts): a snapshot on connect, then
track.created / track.updated / track.lost / track.closed and node.status messages.

Also serves the built geomap (RID_WEB, default ./web) on the same port, so behind
Cloudflare Access the login cookie reaches the socket. A client gets in with ?token=
(local dev over the SSH tunnel) or a valid Cloudflare Access login (RID_ACCESS_TEAM +
RID_ACCESS_AUD set).

Run:  RID_TOKEN=... python3 rid_server.py            (reads RID_SERIAL)
      RID_TOKEN=... python3 rid_server.py - < lines   (reads stdin)
"""

import asyncio
import json
import mimetypes
import os
import sys
import threading
import time
from datetime import datetime, timezone

from websockets.asyncio.server import broadcast, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

TOKEN = os.environ["RID_TOKEN"]  # required: no token, no server
SERIAL = os.environ.get("RID_SERIAL", "/dev/ttyACM0")
PORT = int(os.environ.get("RID_PORT", "8765"))
WEB = os.path.realpath(os.environ.get("RID_WEB", "web"))
ACCESS_TEAM = os.environ.get("RID_ACCESS_TEAM")  # e.g. curly-breeze-e28d.cloudflareaccess.com
ACCESS_AUD = os.environ.get("RID_ACCESS_AUD")  # the Access application's AUD tag
# ponytail: node position from env; send it from the ESP32 or a GPS once nodes move
NODE = {
    "node_id": os.environ.get("RID_NODE_ID", "pi-01"),
    "lat": float(os.environ.get("RID_NODE_LAT", "0")),
    "lon": float(os.environ.get("RID_NODE_LON", "0")),
    "online": True,
    "type": "rid",  # geomap shows it as a Remote ID receiver, not a camera
}
NODES = [NODE] if NODE["lat"] or NODE["lon"] else []  # no position set: don't put it at 0,0
LOST_S = 15  # no packets this long: greyed out in the UI
CLOSE_S = 120  # no packets this long: removed; heard again = new track_id
UPDATE_S = 1  # at most one track.updated per track per second


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN -> None


class Tracks:
    """Track state by uas_id. Methods return the messages to send."""

    def __init__(self, node_id):
        self.node_id = node_id
        self.by_uas = {}  # uas_id -> {"pub": LiveTrack, "seen", "sent", "dirty"}

    def snapshot(self):
        return [t["pub"] for t in self.by_uas.values()]

    def packet(self, p, now):
        uas = (p.get("basic_id") or "").strip() or p.get("mac")
        if not uas:
            return []
        t = self.by_uas.get(uas)
        new = t is None
        if new:
            t = self.by_uas[uas] = {
                "pub": {"track_id": f"{uas}-{int(now)}", "kind": "rid", "uas_id": uas,
                        "latest": {}, "nodes": {}},
                "sent": 0,
            }
        pub = t["pub"]
        was_lost = pub.get("state") == "lost"
        lat, lon = num(p.get("drone_lat")), num(p.get("drone_long"))
        if lat and lon:  # 0,0 = no fix yet: keep the last real position
            pub["latest"].update(lat=lat, lon=lon)
        for src, dst in (("drone_altitude", "alt_geo"), ("drone_speed", "speed_h"),
                         ("pilot_lat", "operator_lat"), ("pilot_long", "operator_lon")):
            if num(p.get(src)) is not None:
                pub["latest"][dst] = num(p.get(src))
        pub["nodes"][self.node_id] = {"rssi": num(p.get("rssi"))}
        pub["state"] = "active"
        pub["last_seen"] = iso(now)
        t["seen"] = now
        t["dirty"] = True
        if new or was_lost or now - t["sent"] >= UPDATE_S:
            return [self._send(t, now, "track.created" if new else "track.updated")]
        return []

    def tick(self, now):
        out = []
        for uas, t in list(self.by_uas.items()):
            pub, quiet = t["pub"], now - t["seen"]
            if quiet >= CLOSE_S:
                del self.by_uas[uas]
                out.append({"type": "track.closed", "data": {"track_id": pub["track_id"]}})
            elif quiet >= LOST_S and pub["state"] != "lost":
                pub["state"] = "lost"
                out.append(self._send(t, now, "track.lost"))
            elif t["dirty"] and now - t["sent"] >= UPDATE_S:  # flush a throttled update
                out.append(self._send(t, now, "track.updated"))
        return out

    def _send(self, t, now, kind):
        t["sent"], t["dirty"] = now, False
        return {"type": kind, "data": t["pub"]}


_jwks = None


def access_ok(assertion):
    """Cloudflare Access login JWT (Cf-Access-Jwt-Assertion header): signed by the team, for our app."""
    global _jwks
    if not (assertion and ACCESS_TEAM and ACCESS_AUD):
        return False
    import jwt  # PyJWT[crypto]; only needed behind Access

    try:
        _jwks = _jwks or jwt.PyJWKClient(f"https://{ACCESS_TEAM}/cdn-cgi/access/certs")
        key = _jwks.get_signing_key_from_jwt(assertion).key
        jwt.decode(assertion, key, algorithms=["RS256"], audience=ACCESS_AUD,
                   issuer=f"https://{ACCESS_TEAM}")
        return True
    except Exception as e:  # bad signature, expired, wrong app, certs unreachable
        print(f"access: {e}", flush=True)
        return False


def static(path):
    """A file of the built geomap, or None. Paths outside WEB are refused."""
    f = os.path.realpath(os.path.join(WEB, path.lstrip("/") or "index.html"))
    if not f.startswith(WEB + os.sep) or not os.path.isfile(f):
        return None
    with open(f, "rb") as fh:
        body = fh.read()
    kind = mimetypes.guess_type(f)[0] or "application/octet-stream"
    return Response(200, "OK", Headers({"Content-Type": kind, "Content-Length": str(len(body))}), body)


def read_lines(src, loop, queue):
    """Thread: push raw lines into the asyncio queue; reopen the port after a drop."""
    if src == "-":
        for line in sys.stdin:
            loop.call_soon_threadsafe(queue.put_nowait, line)
        return
    import serial  # only needed on the Pi

    while True:
        try:
            with serial.Serial(src, 115200, timeout=1) as port:
                print(f"serial open: {src}", flush=True)
                while True:
                    line = port.readline()
                    if line:
                        loop.call_soon_threadsafe(queue.put_nowait, line.decode(errors="replace"))
        except serial.SerialException as e:
            print(f"serial: {e}; retrying in 3 s", flush=True)
            time.sleep(3)


async def main(src):
    tracks = Tracks(NODE["node_id"])
    clients = set()
    queue = asyncio.Queue()

    def send(msgs):
        for m in msgs:
            broadcast(clients, json.dumps(m))
            d, ll = m["data"], m["data"].get("latest", {})
            print(m["type"], d.get("uas_id", d["track_id"]), ll.get("lat"), ll.get("lon"),
                  ll.get("alt_geo"), d.get("nodes", {}).get(NODE["node_id"], {}).get("rssi"), flush=True)

    async def auth(conn, request):
        from hmac import compare_digest
        from urllib.parse import parse_qs, urlsplit

        url = urlsplit(request.path)
        if url.path != "/v1/live":
            return static(url.path) or conn.respond(404, "not found\n")
        if compare_digest(parse_qs(url.query).get("token", [""])[0].encode(), TOKEN.encode()):
            return None
        if await asyncio.to_thread(access_ok, request.headers.get("Cf-Access-Jwt-Assertion")):
            return None
        return conn.respond(403, "bad token\n")

    async def handler(conn):
        await conn.send(json.dumps({"type": "snapshot", "tracks": tracks.snapshot(), "nodes": NODES}))
        clients.add(conn)
        try:
            await conn.wait_closed()
        finally:
            clients.discard(conn)

    async def ticker():
        while True:
            await asyncio.sleep(1)
            send(tracks.tick(time.time()))

    threading.Thread(target=read_lines, args=(src, asyncio.get_running_loop(), queue), daemon=True).start()
    async with serve(handler, "0.0.0.0", PORT, process_request=auth):
        print(f"listening on :{PORT}/v1/live", flush=True)
        asyncio.create_task(ticker())
        while True:
            line = (await queue.get()).strip()
            try:
                p = json.loads(line)
            except ValueError:
                continue  # boot logs and other non-JSON chatter
            if isinstance(p, dict):
                send(tracks.packet(p, time.time()))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else SERIAL))
