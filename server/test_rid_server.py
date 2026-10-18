import os

os.environ.setdefault("RID_TOKEN", "test")
from rid_server import Tracks

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
print("ok")
