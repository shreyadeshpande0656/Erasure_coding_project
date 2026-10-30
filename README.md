# Erasure-Coded File Transfer Lab

A C++ UDP client/server that sends a file as random linear combinations (GF(256)) of k=4 blocks, plus a browser
lab that replays what the real programs did: packets flying, loss, rank growing, Gaussian elimination, SHA-256 check.

## Run (Windows, VS Code terminal)
1. Install g++ (MinGW) and Python 3 (nothing else; the web UI is already built).
2. `build.bat`
3. `python app.py`  (opens http://127.0.0.1:8000)

Mac/Linux: `sh build.sh` then `python3 app.py`.

## Tabs
- **Transfer Lab**: pick a file, set loss, press Start. Replay, pause and change speed freely.
- **Encoding Visualizer**: step through how the first packets were built from the blocks.
- **Decoding Visualizer**: step through the server's Gaussian elimination and verify the rebuilt file.

## Optional: edit the UI
`cd frontend && npm install && npm run build` (needs Node 18+). `npm run dev` for hot reload (run app.py too, then proxy is not set; prefer build).
