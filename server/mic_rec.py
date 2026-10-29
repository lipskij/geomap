"""Record the ESP32 mic mix from the running rid server (/v1/mic) to a WAV file.

Prints each 0.5 s line's level and the drone check's best result while it records, so you can
see what the server hears. Token and port come from ./env, like the service.

Run:  python3 mic_rec.py [seconds] [file.wav]    (no seconds: until Ctrl-C;
                                                  default file: rec/<date-time>.wav)
"""

import asyncio
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

from rid_server import MIC_RATE, PORT, TOKEN, hum  # noqa: E402


async def record(seconds, path):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(MIC_RATE)
        async with connect(f"ws://localhost:{PORT}/v1/mic?token={TOKEN}") as ws:
            print(f"recording to {path}" + (f" for {seconds:g} s" if seconds else ", Ctrl-C to stop"))
            got = 0
            while not seconds or got < seconds * MIC_RATE:
                pcm = await asyncio.wait_for(ws.recv(), 5)  # ESP32 sends every 0.5 s
                w.writeframes(pcm)
                got += len(pcm) // 2
                f0, conf, ok, rms = max(hum(pcm), key=lambda r: r[1])
                print(f"{got / MIC_RATE:6.1f} s  rms {rms:6.0f}  {f0:5.0f} Hz  conf {conf:.2f}"
                      + ("  hum" if ok else ""), flush=True)


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
