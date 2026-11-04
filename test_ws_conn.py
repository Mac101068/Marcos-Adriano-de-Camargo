import asyncio
import websockets
import json

async def test():
    try:
        async with websockets.connect("ws://localhost:8765") as ws:
            msg1 = await ws.recv()
            print("Msg 1:", json.loads(msg1)["type"])
            msg2 = await ws.recv()
            data2 = json.loads(msg2)
            print("Msg 2:", data2["type"])
            boxes = data2["data"].get("boxes", [])
            print(f"Boxes recebidos no INITIAL_DATA: {len(boxes)}")
            gaps = [b for b in boxes if b.get("isGap")]
            print(f"GAPs encontrados nos boxes: {len(gaps)}")
            for g in gaps:
                print(f"  -> GAP {g.get('gapPoints', 0):+.0f} pts no dia {g.get('dayLabel')}")
    except Exception as e:
        print("Erro conexao:", e)

if __name__ == "__main__":
    asyncio.run(test())
