import os
import tempfile

os.environ.setdefault("RID_TOKEN", "test")
os.environ["RID_LOG"] = tempfile.mkdtemp()
from rid_server import CLOSE_S, CONF_OFF, LOG, MIC_FRAME, MIC_RATE, MICS, PITCH_WIN, RMS_MIN, Ears, Tracks, channels, delete_history, hear, history, hum, listen, jpegs, log_file, log_packet, prune

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
# Mic: a hum with 2nd and 3rd harmonics passes every frame; noise, a lone tone or a dead line do not.
# Noise often has some 'harmonics' by chance: its low confidence is what keeps the alarm off
import numpy as np
rng = np.random.default_rng(0)
sec = np.arange(MIC_FRAME) / MIC_RATE
noise = rng.normal(0, 300, MIC_FRAME)
pcm = lambda x: np.clip(x, -32768, 32767).astype(np.int16).tobytes()
frames = hum(pcm(noise + sum(4000 / k * np.sin(2 * np.pi * 300 * k * sec) for k in (1, 2, 3))))
assert len(frames) == 3 and all(ok and abs(f0 - 300) <= 16 and conf > 0.3 for f0, conf, ok, _ in frames), frames
assert max(conf for _, conf, _, _ in hum(pcm(noise))) < CONF_OFF
assert not any(ok for _, _, ok, _ in hum(pcm(noise + 3000 * np.sin(2 * np.pi * 300 * sec))))  # no harmonics
assert all(rms < RMS_MIN for *_, rms in hum(pcm(-(np.arange(MIC_FRAME) % 4 < 2).astype(int))))  # only 0 and -1
assert hum(b"") == []
# Louder 2nd harmonic than f0 (a drone through a small speaker): still f0, not the octave above
frames = hum(pcm(noise + 1500 * np.sin(2 * np.pi * 300 * sec) + 4000 * np.sin(2 * np.pi * 600 * sec)
                 + 1500 * np.sin(2 * np.pi * 900 * sec)))
assert all(ok and abs(f0 - 300) <= 16 for f0, _, ok, _ in frames), frames
# Steady pitch: ok once 1 s (PITCH_WIN frames) of the same tone; notes jumping around never are
from collections import deque
tone = lambda f: pcm(noise + sum(4000 / k * np.sin(2 * np.pi * f * k * sec) for k in (1, 2)))
pitch = deque(maxlen=PITCH_WIN)
assert [ok for _, _, ok, _ in listen(tone(300), pitch) + listen(tone(310), pitch)] == [0, 0, 0, 0, 0, 1]
pitch = deque(maxlen=PITCH_WIN)
assert not any(ok for f in (300, 450, 300, 600, 300, 450) for _, _, ok, _ in listen(tone(f), pitch))
# Several mics: any one hearing the drone is enough, empty slots are skipped, none = silence
drone = tone(300)
pitches = [deque(maxlen=PITCH_WIN) for _ in range(MICS)]
assert [ok for _ in range(2) for _, _, ok, _ in hear([pcm(noise), b"", drone, b""], pitches)][-1]
assert [rms for *_, rms in hear([b"", b""], pitches)] == [0, 0, 0]
x = np.frombuffer(channels([b"", drone]), np.int16).reshape(MIC_FRAME, MICS)
assert not x[:, 0].any() and x[:, 1].tobytes() == drone and not x[:, 2:].any()
# Alarm smoothing: the EMA reaches 0.30 on the 2nd good frame, 2 good frames in a row at 0.30 raise
# it; 8 bad clear it
e = Ears("pi-01")
good, bad = (300, 1.0, True, 500), (300, 0.0, False, 500)
assert [e.check(*good, 10) for _ in range(2)] == [[], []] and e.tick(10) == []
assert [m["type"] for m in e.check(*good, 10)] == ["track.created", "contact.alert"]
first = e.pub["track_id"]
assert e.pub["latest"] == {"node_id": "pi-01", "bearing_deg": None, "classes": ["drone?", "300 Hz"]}
assert e.check(*good, 10.5) == []  # throttled
assert [m["type"] for m in e.check(*good, 11)] == ["track.updated"]
assert all(e.check(*bad, 11.2) == [] for _ in range(7)) and e.check(*good, 11.3) == []  # 7 bad, then good: kept
assert all(e.check(*bad, 11.5) == [] for _ in range(7))
assert [m["type"] for m in e.check(*bad, 11.5)] == ["track.lost"]  # 8th bad in a row
assert e.check(300, 1.0, True, RMS_MIN / 2, 12) == []  # quiet frames never raise it
assert [e.check(*good, 20) for _ in range(2)] == [[], []]
assert [m["type"] for m in e.check(*good, 20)] == ["track.updated"]  # back before closed: no new alert
assert e.pub["track_id"] == first and e.pub["state"] == "active" and e.snapshot() == [e.pub]
assert e.tick(21) == [] and [m["type"] for m in e.tick(22.5)] == ["track.lost"]  # ESP32 went quiet
assert [m["type"] for m in e.tick(20 + CLOSE_S)] == ["track.closed"] and e.snapshot() == []
assert all(e.check(300, 1.0, True, 0, 199) == [] for _ in range(20))  # silence decays the EMA
assert [e.check(*good, 200) for _ in range(2)] == [[], []]
assert [m["type"] for m in e.check(*good, 200)] == ["track.created", "contact.alert"]  # after closed: new
assert e.pub["track_id"] != first
print("ok")
