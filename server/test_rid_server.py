import os
import tempfile

os.environ.setdefault("RID_TOKEN", "test")
os.environ["RID_LOG"] = tempfile.mkdtemp()
from rid_server import LOG, Tracks, delete_history, history, jpegs, log_file, log_packet, prune

p = {"basic_id": "D1", "mac": "aa", "rssi": -70, "drone_lat": 54.7, "drone_long": 25.29,
     "drone_altitude": 50, "pilot_lat": 54.7, "pilot_long": 25.29}
t = Tracks("pi-01")

[m] = t.packet(p, 100)
assert m["type"] == "track.created" and m["data"]["latest"]["lat"] == 54.7
assert m["data"]["nodes"] == {"pi-01": {"rssi": -70}}
first_id = m["data"]["track_id"]

assert t.packet({**p, "drone_lat": 0, "drone_long": 0}, 100.5) == []  # throttled
assert t.by_uas["D1"]["pub"]["latest"]["lat"] == 54.7  # 0,0 keeps last fix
assert [m["type"] for m in t.tick(101)] == ["track.updated"]  # throttled one flushed
assert t.tick(102) == []

assert [m["type"] for m in t.tick(115.5)] == ["track.lost"]
assert t.packet(p, 116)[0]["data"]["state"] == "active"  # back from lost: sent at once

assert [m["type"] for m in t.tick(236)] == ["track.closed"]
[m] = t.packet({**p, "basic_id": "", "mac": "bb"}, 300)  # no basic_id: keyed by mac
assert m["data"]["uas_id"] == "bb"
[m] = t.packet(p, 301)
assert m["type"] == "track.created" and m["data"]["track_id"] != first_id
# Flight logs: one CSV per track, listed newest first, unsafe ids never touch the disk
log_packet("D1-100", p, 100)
log_packet("D1-100", {**p, "drone_lat": 54.71}, 101)
log_packet("aa:bb/../x-300", {**p, "basic_id": "", "mac": "aa:bb"}, 300)
h = history()
assert [e["id"] for e in h] == ["aa_bb____x-300", "D1-100"], h
assert h[1] == {"id": "D1-100", "uas_id": "D1", "start": h[1]["start"], "end": h[1]["end"], "points": 2}
assert h[0]["uas_id"] == "aa:bb"
assert open(log_file("D1-100")).readline().startswith("timestamp,mac,rssi,drone_lat,drone_long")
assert log_file("../D1-100") is None and log_file(None) is None
assert delete_history(["../../etc/passwd", "nope", "D1-100"]) == ["D1-100"]
assert [e["id"] for e in history()] == ["aa_bb____x-300"]
os.utime(log_file("aa_bb____x-300"), (0, 0))  # last written in 1970
prune(31 * 86400)
assert history() == [] and os.listdir(LOG) == []
# Camera: MJPEG stream split into whole JPEGs; a frame cut mid-read waits for the rest
a, b = b"\xff\xd8\x01\xff\x00\xff\xd9", b"\xff\xd8\x02\xff\xd9"
assert jpegs(a + b + b"\xff\xd8\x03") == ([a, b], b"\xff\xd8\x03")
assert jpegs(b"\xff\xd8\x03") == ([], b"\xff\xd8\x03")
print("ok")
