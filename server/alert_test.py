"""Ask the running rid server to send a test contact.alert to every connected app, and show
what this client receives back. Token and port come from ./env, like the service."""

import asyncio
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
for line in open(os.path.join(HERE, "env")):
    k, _, v = line.strip().partition("=")
    if k.startswith("RID_"):
        os.environ.setdefault(k, v)

from websockets.asyncio.client import connect  # noqa: E402

PORT, TOKEN = os.environ.get("RID_PORT", "8765"), os.environ["RID_TOKEN"]


async def main():
    async with connect(f"ws://localhost:{PORT}/v1/live?token={TOKEN}") as ws:
        await ws.recv()  # snapshot
        await ws.send(json.dumps({"type": "contact.test"}))
        while (m := json.loads(await asyncio.wait_for(ws.recv(), 5)))["type"] != "contact.alert":
            pass
        print("sent:", json.dumps(m))


asyncio.run(main())
