"""Remote ID live server for geomap.

Reads JSON lines from an ESP32 Remote ID receiver (USB serial, or stdin for testing)
and serves them as geomap's live feed (see src/live.ts): a snapshot on connect, then
track.created / track.updated / track.lost / track.closed and node.status messages.

Also serves the built geomap (RID_WEB, default ./web) on the same port, so behind
Cloudflare Access the login cookie reaches the socket. A client gets in with ?token=
(local dev over the SSH tunnel) or a valid Cloudflare Access login (RID_ACCESS_TEAM +
RID_ACCESS_AUD set).

Every packet is also appended to a CSV per flight in RID_LOG (default ./log), kept
RID_KEEP_DAYS (default 30). GET /v1/history lists them, GET /v1/history/<id>.csv
returns one (same columns as samples/wifi-remoteid-log-*.csv, so geomap can replay it),
and a {"type": "history.delete", "ids": [...]} message on the socket deletes them.

With a Pi camera attached, /v1/camera streams it as one JPEG per binary message, same
login as /v1/live. rpicam-vid runs only while someone watches; each viewer answers every
frame with any message and gets at most CAM_IN_FLIGHT unanswered, so a slow link drops
frames instead of falling behind.

With a USB mic attached, an FFT check listens for a drone-like hum (a tone plus its 2nd
and 3rd harmonics) and reports it as a contact track heard by this node, no direction.
RID_MIC_DB (default 12) is how far above the background all three must stand;
RID_MIC_LOG=1 prints every check's score, for tuning; RID_MIC=off turns it off.

Run:  RID_TOKEN=... python3 rid_server.py            (reads RID_SERIAL)
      RID_TOKEN=... python3 rid_server.py - < lines   (reads stdin)
"""

import asyncio
import csv
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

from websockets.asyncio.server import broadcast, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Response

TOKEN = os.environ["RID_TOKEN"]  # required: no token, no server
SERIAL = os.environ.get("RID_SERIAL", "/dev/ttyACM0")
PORT = int(os.environ.get("RID_PORT", "8765"))
WEB = os.path.realpath(os.environ.get("RID_WEB", "web"))
ACCESS_TEAM = os.environ.get("RID_ACCESS_TEAM")  # e.g. curly-breeze-e28d.cloudflareaccess.com
ACCESS_AUD = os.environ.get("RID_ACCESS_AUD")  # the Access application's AUD tag
ORIGIN = os.environ.get("RID_ORIGIN")  # e.g. https://owlsystem.gungi.chat: the only site whose sockets a login opens
LOG = os.path.realpath(os.environ.get("RID_LOG", "log"))
KEEP_S = float(os.environ.get("RID_KEEP_DAYS", "30")) * 86400
COLS = ["timestamp", "mac", "rssi", "drone_lat", "drone_long", "drone_altitude",
        "pilot_lat", "pilot_long", "basic_id"]
LOG_ID = re.compile(r"[A-Za-z0-9_-]{1,120}")  # log file names; anything else is refused
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
# ponytail: fixed size and rate; the frame acks cut the rate to what the link carries
CAM_CMD = ["rpicam-vid", "-t", "0", "-n", "--codec", "mjpeg", "--width", "1280", "--height", "720",
           "--framerate", "15", "-q", "50", "--flush", "-o", "-"]
CAM_IN_FLIGHT = 2  # frames sent but not yet answered, per viewer
MIC = os.environ.get("RID_MIC")  # ALSA device, e.g. plughw:CARD=Device; unset = first USB mic; off = none
MIC_DB = float(os.environ.get("RID_MIC_DB", "12"))
MIC_LOG = os.environ.get("RID_MIC_LOG") == "1"
MIC_RATE = 16000
MIC_FRAME = MIC_RATE // 2  # 0.5 s per check: 2 Hz FFT resolution
SOUND_LOST_S = 2  # no hum this long: contact lost


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

    @staticmethod
    def key(p):
        return (p.get("basic_id") or "").strip() or p.get("mac")

    def packet(self, p, now):
        uas = self.key(p)
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


def camera_present():
    try:
        out = subprocess.run(["rpicam-hello", "--list-cameras"], capture_output=True, text=True,
                             timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):  # not a Pi, or no camera tools
        return False
    return re.search(r"^\s*0 : ", out, re.M) is not None


def jpegs(buf):
    """Split an MJPEG byte stream into whole JPEGs; returns (frames, leftover bytes).
    FF D9 only appears as the end marker: inside the image data FF is always followed by 00."""
    frames = []
    while (end := buf.find(b"\xff\xd9")) >= 0:
        frames.append(buf[:end + 2])
        buf = buf[end + 2:]
    return frames, buf


def find_mic():
    """ALSA name of the first capture device (arecord -l), or None."""
    if MIC:
        return None if MIC == "off" else MIC
    try:
        out = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"^card \d+: (\w+) \[", out, re.M)
    return f"plughw:CARD={m[1]}" if m else None


def hum(samples):
    """(f0 Hz, score dB) of 16-bit mono PCM: the strongest 80-500 Hz tone, scored by the
    weakest of it and its 2nd and 3rd harmonics against the 100-1000 Hz median level.
    ponytail: plain harmonic check, fooled by engines and fans; a classifier when it matters"""
    import numpy as np  # only needed with a mic

    x = np.frombuffer(samples, np.int16).astype(np.float32)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    hz = np.fft.rfftfreq(len(x), 1 / MIC_RATE)
    floor = np.median(spec[(hz >= 100) & (hz <= 1000)]) + 1e-9
    f0 = hz[np.argmax(np.where((hz >= 80) & (hz <= 500), spec, 0))]
    step = hz[1]
    peak = lambda f: spec[max(0, round(f / step) - 2):round(f / step) + 3].max()  # ±4 Hz
    return float(f0), float(min(20 * np.log10(peak(k * f0) / floor) for k in (1, 2, 3)))


class Ears:
    """The mic's one contact track: heard -> active, quiet SOUND_LOST_S -> lost, CLOSE_S -> closed."""

    def __init__(self, node_id):
        self.node_id = node_id
        self.pub = None
        self.heard = self.sent = 0
        self.streak = 0  # checks in a row above MIC_DB at a steady pitch
        self.f0 = 0  # pitch of the last check above MIC_DB

    def snapshot(self):
        return [self.pub] if self.pub else []

    def check(self, f0, score, now):
        # Steady = within 5% of the last check: a drone holds its pitch, speech glides
        steady = abs(f0 - self.f0) <= 0.05 * self.f0
        self.streak = (self.streak + 1 if steady else 1) if score >= MIC_DB else 0
        self.f0 = f0 if score >= MIC_DB else 0
        new = not self.pub or self.pub["state"] == "lost"
        if self.streak < (3 if new else 1):  # a new contact needs 1.5 s of steady hum
            return []
        self.heard = now
        out = [{"type": "track.closed", "data": {"track_id": self.pub["track_id"]}}] if self.pub and new else []
        if new:
            self.pub = {"track_id": f"sound-{self.node_id}-{int(now)}", "kind": "contact",
                        "audio_confirmed": True}
        self.pub.update(state="active", last_seen=iso(now),
                        latest={"node_id": self.node_id, "bearing_deg": None,
                                "classes": ["drone?", f"{f0:.0f} Hz"]})
        if new:
            self.sent = now
            return out + [{"type": "track.created", "data": self.pub},
                          {"type": "contact.alert", "data": self.pub}]
        if now - self.sent >= UPDATE_S:
            self.sent = now
            return [{"type": "track.updated", "data": self.pub}]
        return []

    def tick(self, now):
        if not self.pub:
            return []
        if self.pub["state"] == "active" and now - self.heard >= SOUND_LOST_S:
            self.pub["state"] = "lost"
            return [{"type": "track.lost", "data": self.pub}]
        if now - self.heard >= CLOSE_S:
            done, self.pub = self.pub, None
            return [{"type": "track.closed", "data": {"track_id": done["track_id"]}}]
        return []


def log_packet(track_id, p, now):
    """Append a packet to its flight's CSV. The id comes from radio data: unsafe characters become _."""
    f = os.path.join(LOG, re.sub(r"[^A-Za-z0-9_-]", "_", track_id)[:120] + ".csv")
    try:
        os.makedirs(LOG, exist_ok=True)
        new = not os.path.exists(f)
        with open(f, "a", newline="") as fh:
            w = csv.writer(fh)
            if new:
                w.writerow(COLS)
            w.writerow([iso(now)] + [p.get(c, "") for c in COLS[1:]])
    except OSError as e:  # SD card full or read-only: keep serving live data
        print(f"log: {e}", flush=True)


def log_file(log_id):
    """Path of a flight log by id, or None (unknown, or not a plain log name)."""
    if not (isinstance(log_id, str) and LOG_ID.fullmatch(log_id)):
        return None
    f = os.path.join(LOG, log_id + ".csv")
    return f if os.path.isfile(f) else None


def history():
    """Flight logs, newest first. ponytail: reads every file per call; an index if it gets slow."""
    out = []
    for name in os.listdir(LOG) if os.path.isdir(LOG) else []:
        if not (name.endswith(".csv") and log_file(name[:-4])):
            continue
        with open(os.path.join(LOG, name), newline="") as fh:
            rows = list(csv.DictReader(fh))
        if rows:
            out.append({"id": name[:-4], "uas_id": rows[0]["basic_id"] or rows[0]["mac"],
                        "start": rows[0]["timestamp"], "end": rows[-1]["timestamp"],
                        "points": len(rows)})
    return sorted(out, key=lambda h: h["start"], reverse=True)


def delete_history(ids):
    """Delete flight logs from the SD card; returns the ids actually deleted."""
    done = []
    for i in ids:
        if f := log_file(i):
            os.remove(f)
            done.append(i)
    return done


def prune(now):
    """Delete flight logs not written to for KEEP_S."""
    for name in os.listdir(LOG) if os.path.isdir(LOG) else []:
        f = os.path.join(LOG, name)
        if name.endswith(".csv") and os.path.getmtime(f) < now - KEEP_S:
            os.remove(f)
            print(f"log: pruned {name}", flush=True)


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


def respond(body, kind):
    return Response(200, "OK", Headers({"Content-Type": kind, "Content-Length": str(len(body)),
                                        "Cache-Control": "no-store"}), body)


def static(path):
    """A file of the built geomap, or None. Paths outside WEB are refused."""
    f = os.path.realpath(os.path.join(WEB, path.lstrip("/") or "index.html"))
    if not f.startswith(WEB + os.sep) or not os.path.isfile(f):
        return None
    with open(f, "rb") as fh:
        return respond(fh.read(), mimetypes.guess_type(f)[0] or "application/octet-stream")


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
    NODE["camera"] = await asyncio.to_thread(camera_present)
    print(f"camera: {'found' if NODE['camera'] else 'none'}", flush=True)
    mic = await asyncio.to_thread(find_mic)
    ears = Ears(NODE["node_id"])
    print(f"mic: {mic or 'none'}", flush=True)
    viewers = {}  # camera socket -> frames sent but not answered
    cam_task = None

    async def camera():
        """Run rpicam-vid while anyone watches; each read sends only the newest whole frame."""
        while viewers:
            proc = await asyncio.create_subprocess_exec(*CAM_CMD, stdout=subprocess.PIPE,
                                                        stderr=subprocess.DEVNULL)
            buf = b""
            try:
                while viewers and (chunk := await proc.stdout.read(1 << 16)):
                    frames, buf = jpegs(buf + chunk)
                    if frames:
                        for c, n in list(viewers.items()):
                            if n < CAM_IN_FLIGHT:
                                viewers[c] = n + 1
                                broadcast([c], frames[-1])
            finally:
                if proc.returncode is None:
                    proc.kill()
                await proc.wait()
            if viewers:  # rpicam-vid quit by itself (camera busy or unplugged)
                print(f"camera: rpicam-vid exited {proc.returncode}; retrying in 3 s", flush=True)
                await asyncio.sleep(3)

    def send(msgs):
        for m in msgs:
            broadcast(clients, json.dumps(m))
            d, ll = m["data"], m["data"].get("latest", {})
            print(m["type"], d.get("uas_id", d["track_id"]), ll.get("lat"), ll.get("lon"),
                  ll.get("alt_geo"), d.get("nodes", {}).get(NODE["node_id"], {}).get("rssi"), flush=True)

    async def listen():
        """Read the mic in MIC_FRAME chunks and check each; restart arecord if it quits."""
        while True:
            proc = await asyncio.create_subprocess_exec(
                "arecord", "-q", "-D", mic, "-f", "S16_LE", "-r", str(MIC_RATE), "-c", "1", "-t", "raw",
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                while True:
                    f0, score = hum(await proc.stdout.readexactly(MIC_FRAME * 2))
                    if MIC_LOG:
                        print(f"mic: {f0:.0f} Hz {score:.1f} dB", flush=True)
                    send(ears.check(f0, score, time.time()))
            except asyncio.IncompleteReadError:
                print("mic: arecord stopped; retrying in 3 s", flush=True)
            finally:
                if proc.returncode is None:
                    proc.kill()
                await proc.wait()
            await asyncio.sleep(3)

    async def auth(conn, request):
        from hmac import compare_digest
        from urllib.parse import parse_qs, urlsplit

        url = urlsplit(request.path)
        if not url.path.startswith("/v1/"):
            return static(url.path) or conn.respond(404, "not found\n")
        if not compare_digest(parse_qs(url.query).get("token", [""])[0].encode(), TOKEN.encode()):
            if not await asyncio.to_thread(access_ok, request.headers.get("Cf-Access-Jwt-Assertion")):
                return conn.respond(403, "bad token\n")
            # Login cookie: refuse sockets other sites open with it (they could delete logs, watch the camera)
            if url.path in ("/v1/live", "/v1/camera") and (not ORIGIN or request.headers.get("Origin") != ORIGIN):
                return conn.respond(403, "bad origin\n")
        if url.path == "/v1/live" or (url.path == "/v1/camera" and NODE["camera"]):
            return None
        if url.path == "/v1/history":
            return respond(json.dumps(history()).encode(), "application/json")
        m = re.fullmatch(r"/v1/history/(.+)\.csv", url.path)
        if m and (f := log_file(m[1])):
            with open(f, "rb") as fh:
                return respond(fh.read(), "text/csv")
        return conn.respond(404, "not found\n")

    async def handler(conn):
        nonlocal cam_task
        if conn.request.path.startswith("/v1/camera"):
            viewers[conn] = 0
            if not cam_task or cam_task.done():
                cam_task = asyncio.create_task(camera())
            try:
                async for _ in conn:  # any message answers one frame
                    viewers[conn] = max(0, viewers[conn] - 1)
            except ConnectionClosed:
                pass
            finally:
                viewers.pop(conn, None)
            return
        await conn.send(json.dumps({"type": "snapshot", "tracks": tracks.snapshot() + ears.snapshot(),
                                    "nodes": NODES}))
        clients.add(conn)
        try:
            async for msg in conn:
                try:
                    m = json.loads(msg)
                except ValueError:
                    continue
                if isinstance(m, dict) and m.get("type") == "history.delete" and isinstance(m.get("ids"), list):
                    ids = delete_history(m["ids"])
                    print(f"history deleted: {ids}", flush=True)
                    await conn.send(json.dumps({"type": "history.deleted", "data": {"ids": ids}}))
        except ConnectionClosed:
            pass
        finally:
            clients.discard(conn)

    async def ticker():
        pruned = 0
        while True:
            await asyncio.sleep(1)
            now = time.time()
            send(tracks.tick(now) + ears.tick(now))
            if now - pruned >= 3600:
                pruned = now
                prune(now)

    threading.Thread(target=read_lines, args=(src, asyncio.get_running_loop(), queue), daemon=True).start()
    async with serve(handler, "0.0.0.0", PORT, process_request=auth):
        print(f"listening on :{PORT}/v1/live", flush=True)
        asyncio.create_task(ticker())
        if mic:
            asyncio.create_task(listen())
        while True:
            line = (await queue.get()).strip()
            try:
                p = json.loads(line)
            except ValueError:
                continue  # boot logs and other non-JSON chatter
            if isinstance(p, dict):
                now = time.time()
                send(tracks.packet(p, now))
                if t := tracks.by_uas.get(Tracks.key(p)):
                    log_packet(t["pub"]["track_id"], p, now)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else SERIAL))
