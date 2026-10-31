"""Record the ESP32 mics from the running rid server (/v1/mic) to a MICS-channel WAV file.

Prints each 0.5 s line's drone check per live mic while it records, as "<mic>:<pitch>Hz <conf>"
("!" = hum, "*" marks the mic the alarm used), so you can see what the server hears. Token and port come from ./env, like the service.

Run:  python3 mic_rec.py [seconds] [file.wav]    (no seconds: until Ctrl-C;
                                                  default file: rec/<date-time>.wav)
"""

import asyncio
from collections import deque
import os
import sys
import wave
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
for line in open(os.path.join(HERE, "env")):
    k, _, v = line.strip().partition("=")
    if k.startswith("RID_"):
        os.environ.setdefault(k, v)

from websockets.asyncio.client import connect  # noqa: E402

import numpy as np  # noqa: E402

from rid_server import MIC_RATE, MICS, PITCH_WIN, PORT, TOKEN, listen  # noqa: E402


async def record(seconds, path):
    with wave.open(path, "wb") as w:
        w.setnchannels(MICS)
        w.setsampwidth(2)
        w.setframerate(MIC_RATE)
        async with connect(f"ws://localhost:{PORT}/v1/mic?token={TOKEN}") as ws:
            print(f"recording to {path}" + (f" for {seconds:g} s" if seconds else ", Ctrl-C to stop"))
            got = 0
            pitches = [deque(maxlen=PITCH_WIN) for _ in range(MICS)]
            while not seconds or got < seconds * MIC_RATE:
                pcm = await asyncio.wait_for(ws.recv(), 5)  # ESP32 sends every 0.5 s
                w.writeframes(pcm)
                x = np.frombuffer(pcm, np.int16).reshape(-1, MICS)
                got += len(x)
                best = {m: max(listen(x[:, m].tobytes(), pitches[m]), key=lambda r: (r[2], r[1]))
                        for m in range(MICS) if x[:, m].any()}
                top = max(best, key=lambda m: (best[m][2], best[m][1]), default=None)
                print(f"{got / MIC_RATE:5.1f}s" + "".join(
                    f" {'*' if m == top else ' '}{m + 1}:{f0:4.0f}Hz {conf:.2f}{'!' if ok else ' '}"
                    for m, (f0, conf, ok, _) in best.items()) or " no live mic", flush=True)


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 0
    path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        HERE, "rec", datetime.now().strftime("%Y%m%d-%H%M%S") + ".wav")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    try:
        asyncio.run(record(seconds, path))
    except KeyboardInterrupt:
        pass
    except TimeoutError:
        sys.exit("no mic data for 5 s: is the ESP32 plugged in?")
    except OSError as e:
        sys.exit(f"can't reach the rid server on :{PORT}: {e}")
    print(f"saved {path}")


if __name__ == "__main__":
    main()
