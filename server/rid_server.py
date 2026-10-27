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

The ESP32 also streams its INMP441 mic as {"mic": "<base64 16-bit PCM, 16 kHz>"} lines, one
per 0.5 s (see firmware/). An FFT check listens for a drone-like hum (a tone plus its 2nd
and 3rd harmonics) and reports it as a contact track heard by this node, no direction.
RID_MIC_CONF (default 0.30) is the smoothed confidence that raises it;
RID_MIC_LOG=1 prints every check's result, for tuning.

Run:  RID_TOKEN=... python3 rid_server.py            (reads RID_SERIAL)
      RID_TOKEN=... python3 rid_server.py - < lines   (reads stdin)
"""

import asyncio
import base64
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
ORIGIN = os.environ.get("RID_ORIGIN")  # e.g. https://owlsystem.net: the only site whose sockets a login opens
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
MIC_LOG = os.environ.get("RID_MIC_LOG") == "1"
MIC_RATE = 16000  # must match the firmware
MIC_FRAME = MIC_RATE // 2  # samples per mic line: 0.5 s
# Drone check and alarm smoothing ported from batear (github.com/batear-io/batear, MIT).
# Its 1024-point frames, one per ~167 ms like its 64 ms frame + 100 ms hop, so its
# thresholds and timings carry over unchanged
FFT_N = 1024
FRAMES_PER_LINE = 3
F0_MIN, F0_MAX = 180, 2400  # Hz; 3 x f0 stays below Nyquist
PEAK_MIN_SNR = 4  # f0 power vs the mean spectrum
MIN_H2, MIN_H3 = 0.07, 0.035  # 2nd and 3rd harmonic power vs f0
RMS_MIN = 0.0004 * 32768  # windowed RMS below this: silence, or a dead mic line
EMA_ALPHA = 0.25
CONF_ON = float(os.environ.get("RID_MIC_CONF", "0.30"))
CONF_OFF = CONF_ON * 0.6  # batear: 0.30 on, 0.18 off
SUSTAIN_ON, SUSTAIN_OFF = 2, 8  # frames in a row to raise / clear the contact
PITCH_TOL = 0.05  # ours, not batear's: f0 within 5% of the last frame, a drone holds it, speech glides
SOUND_LOST_S = 2  # no mic frames this long (ESP32 quiet): contact lost


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


def hum(samples):
    """Drone check of 16-bit mono PCM, per FFT_N frame: [(f0 Hz, confidence 0..1, harmonics ok,
    windowed rms)]. f0 is the strongest F0_MIN-F0_MAX tone; ok when it stands PEAK_MIN_SNR over
    the mean spectrum and its 2nd and 3rd harmonics reach MIN_H2 / MIN_H3 of its power.
    ponytail: harmonic heuristic, fooled by engines and fans; a classifier when it matters"""
    import numpy as np  # only needed once the mic sends

    x = np.frombuffer(samples, np.int16).astype(np.float32)
    if len(x) < FFT_N:
        return []
    step = MIC_RATE / FFT_N
    k0, k1 = int(np.ceil(F0_MIN / step)), int(F0_MAX // step)
    out = []
    for start in np.linspace(0, len(x) - FFT_N, FRAMES_PER_LINE).astype(int):
        w = x[start:start + FFT_N] * np.hanning(FFT_N)
        psd = np.abs(np.fft.rfft(w)) ** 2
        floor = psd[1:].mean() + 1e-18
        k = k0 + int(np.argmax(psd[k0:k1 + 1]))
        # The 2nd or 3rd harmonic is often louder than f0: also try the peak / 2 and / 3 as f0
        ok, conf, f0 = max(_harmonics(psd, floor, c) for c in (k, round(k / 2), round(k / 3)) if c >= k0)
        out.append((f0 * step, conf, ok, float(np.sqrt((w ** 2).mean()))))
    return out


def _harmonics(psd, floor, k):
    """(ok, confidence, f0 bin) of hum()'s check with f0 at the strongest bin within ±2 of k."""
    k += int(psd[k - 2:k + 3].argmax()) - 2
    snr = psd[k] / floor
    h2, h3 = (psd[m * k - 2:m * k + 3].max() / (psd[k] + 1e-18) for m in (2, 3))  # ±2 bins
    ok = bool(snr >= PEAK_MIN_SNR and h2 >= MIN_H2 and h3 >= MIN_H3)
    if snr < PEAK_MIN_SNR:
        return ok, 0.0, k
    if ok:
        return ok, float(min(1.0, snr / 25 * (h2 * h3) ** 0.5)), k
    return ok, float(min(0.99, min(1.0, snr / 40) * max(h2 / MIN_H2, h3 / MIN_H3))), k


class Ears:
    """The mic's one contact track, with batear's alarm smoothing: a confidence EMA raises it
    after SUSTAIN_ON good frames in a row at CONF_ON, and SUSTAIN_OFF bad ones (or SOUND_LOST_S
    without frames) mark it lost; CLOSE_S lost -> closed. Heard again after lost = new track_id.
    Good = harmonics ok at a steady pitch (PITCH_TOL)."""

    def __init__(self, node_id):
        self.node_id = node_id
        self.pub = None
        self.heard = self.sent = 0
        self.ema = 0.0
        self.on = self.off = 0  # good / bad frames in a row
        self.f0 = 0  # last frame's pitch

    def snapshot(self):
        return [self.pub] if self.pub else []

    def check(self, f0, conf, ok, rms, now):
        ok = ok and abs(f0 - self.f0) <= max(PITCH_TOL * f0, 1.5 * MIC_RATE / FFT_N)  # ±1.5 bins at least
        self.f0 = f0
        loud = rms >= RMS_MIN
        if loud:
            self.ema = EMA_ALPHA * (conf if ok else min(conf, 0.15)) + (1 - EMA_ALPHA) * self.ema
        else:
            self.ema *= 1 - EMA_ALPHA
        if not (self.pub and self.pub["state"] == "active"):  # waiting for a drone
            self.on = self.on + 1 if loud and ok and self.ema >= CONF_ON else 0
            if self.on < SUSTAIN_ON:
                return []
            self.on = self.off = 0
            out = [{"type": "track.closed", "data": {"track_id": self.pub["track_id"]}}] if self.pub else []
            self.pub = {"track_id": f"sound-{self.node_id}-{int(now)}", "kind": "contact",
                        "audio_confirmed": True}
            self._heard(f0, now)
            self.sent = now
            return out + [{"type": "track.created", "data": self.pub},
                          {"type": "contact.alert", "data": self.pub}]
        if not loud or not ok or self.ema < CONF_OFF:
            self.off += 1
            if self.off < SUSTAIN_OFF:
                return []
            self.off = 0
            self.pub["state"] = "lost"
            return [{"type": "track.lost", "data": self.pub}]
        self.off = 0
        self._heard(f0, now)
        if now - self.sent >= UPDATE_S:
            self.sent = now
            return [{"type": "track.updated", "data": self.pub}]
        return []

    def _heard(self, f0, now):
        self.heard = now
        self.pub.update(state="active", last_seen=iso(now),
                        latest={"node_id": self.node_id, "bearing_deg": None,
                                "classes": ["drone?", f"{f0:.0f} Hz"]})

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
                buf = b""
                while True:  # whole chunks: readline() reads byte by byte, too slow for the mic stream
                    buf += port.read(max(1, port.in_waiting))
                    *lines, buf = buf.split(b"\n")
                    for line in lines:
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
    ears = Ears(NODE["node_id"])
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
        while True:
            line = (await queue.get()).strip()
            try:
                p = json.loads(line)
            except ValueError:
                continue  # boot logs and other non-JSON chatter
            if isinstance(p, dict) and "mic" in p:
                try:
                    frames = hum(base64.b64decode(p["mic"]))
                except (TypeError, ValueError):  # cut-off line: odd byte count or bad base64
                    continue
                now = time.time()
                for f0, conf, ok, rms in frames:
                    send(ears.check(f0, conf, ok, rms, now))
                    if MIC_LOG:
                        print(f"mic: {f0:.0f} Hz conf {conf:.2f} ok {ok:d} ema {ears.ema:.2f} rms {rms:.0f}",
                              flush=True)
            elif isinstance(p, dict):
                now = time.time()
                send(tracks.packet(p, now))
                if t := tracks.by_uas.get(Tracks.key(p)):
                    log_packet(t["pub"]["track_id"], p, now)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else SERIAL))
