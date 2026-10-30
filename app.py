#!/usr/bin/env python3
"""Bridge between the web interface and the C++ programs.

    python app.py            (Windows)        python3 app.py          (Mac / Linux)

What it does
  * serves the React app from frontend/dist
  * POST /api/run   starts the real C++ server and client (UDP on localhost), waits for them,
                    merges their JSON-lines event logs and returns the events to the browser
  * GET  /api/samples, /api/code, /api/download/<run id>

Only the Python standard library is used. The server listens on 127.0.0.1 only.
"""
import hashlib
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
EXE = ".exe" if os.name == "nt" else ""
SERVER_BIN = os.path.join(ROOT, "server" + EXE)
CLIENT_BIN = os.path.join(ROOT, "client" + EXE)
SAMPLES = os.path.join(ROOT, "samples")
DIST = os.path.join(ROOT, "frontend", "dist")
RUNS = os.path.join(ROOT, "runs")
BACKEND = os.path.join(ROOT, "backend")
KEEP_RUNS = 15

RUN_LOCK = threading.Lock()
RUN_DIRS = {}          # run id -> output file path


# ------------------------------------------------------------------ helpers
def free_udp_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def num(v, default, lo, hi, cast=float):
    try:
        x = cast(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


def list_samples():
    out = []
    if not os.path.isdir(SAMPLES):
        return out
    for name in sorted(os.listdir(SAMPLES)):
        p = os.path.join(SAMPLES, name)
        if not os.path.isfile(p):
            continue
        size = os.path.getsize(p)
        ext = os.path.splitext(name)[1].lower().lstrip(".")
        kind = {"png": "Image", "jpg": "Image", "pdf": "PDF document", "txt": "Text file"}.get(ext, ext.upper() or "File")
        k = 4
        block = -(-size // k)
        out.append({"name": name, "size": size, "type": kind, "ext": ext, "k": k, "block": block,
                    "ok": block <= 1454})
    return out


def read_events(path):
    ev = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        ev.append(json.loads(line))
                    except ValueError:
                        pass
    return ev


def kill(p):
    if p and p.poll() is None:
        try:
            p.kill()
        except OSError:
            pass


def do_run(opts):
    """Run one real transfer. Returns a dict (events + summary)."""
    if not (os.path.isfile(SERVER_BIN) and os.path.isfile(CLIENT_BIN)):
        raise RuntimeError("The C++ programs are not built yet. Run build.bat (Windows) or sh build.sh (Mac/Linux) first.")
    sample = os.path.basename(opts.get("sample", ""))
    src = os.path.join(SAMPLES, sample)
    if not sample or not os.path.isfile(src):
        raise RuntimeError("unknown sample file")

    loss = num(opts.get("loss"), 0.3, 0.0, 0.8)
    coded = bool(opts.get("coded", True))
    topup = bool(opts.get("topup", True))
    latency = num(opts.get("latency"), 450.0, 0.0, 1500.0)
    jitter = num(opts.get("jitter"), 0.0, 0.0, 1500.0)
    ack_loss = num(opts.get("ack_loss"), 0.0, 0.0, 0.9)
    rate = num(opts.get("rate"), 4, 1, 50, int)
    seed = num(opts.get("seed"), int(time.time()) % 100000, 0, 2 ** 31 - 1, int)

    rid = uuid.uuid4().hex[:10]
    rdir = os.path.join(RUNS, rid)
    out_dir = os.path.join(rdir, "out")
    os.makedirs(out_dir)
    ctrace, strace = os.path.join(rdir, "client.jsonl"), os.path.join(rdir, "server.jsonl")
    port = free_udp_port()

    server_idle = 8.0 if topup else 2.5 + (latency + jitter) / 1000.0
    linger = (latency + jitter) / 1000.0 + 0.9
    scmd = [SERVER_BIN, str(port), out_dir, "--once", "--timeout", str(server_idle),
            "--linger", "%.2f" % linger, "--trace", strace]
    if ack_loss > 0:
        scmd += ["--ack-loss", str(ack_loss)]
    ccmd = [CLIENT_BIN, "127.0.0.1", str(port), src, "--k", "4", "--redundancy", "1.5", "--loss", str(loss),
            "--rate", str(rate), "--seed", str(seed), "--latency", str(latency), "--jitter", str(jitter),
            "--reliable-meta", "--trace", ctrace, "--timeout", "25"]
    if coded:
        ccmd.append("--coded")
    if not topup:
        ccmd += ["--max-extra", "0"]

    flags = 0x08000000 if os.name == "nt" else 0          # no console window on Windows
    sp = subprocess.Popen(scmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True,
                          creationflags=flags)
    slog, clog = [], []
    t_reader = threading.Thread(target=lambda: [slog.append(l.rstrip()) for l in sp.stdout], daemon=True)
    t_reader.start()
    cp = None
    try:
        t0 = time.time()
        while time.time() - t0 < 5 and not any("listening" in l for l in slog):
            if sp.poll() is not None:
                break
            time.sleep(0.02)
        if sp.poll() is not None:
            raise RuntimeError("The server program could not start: " + " ".join(slog[-2:]))
        cp = subprocess.Popen(ccmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True,
                              creationflags=flags)
        c_reader = threading.Thread(target=lambda: [clog.append(l.rstrip()) for l in cp.stdout], daemon=True)
        c_reader.start()
        try:
            cp.wait(timeout=40)
        except subprocess.TimeoutExpired:
            kill(cp)
        try:
            sp.wait(timeout=server_idle + linger + 8)
        except subprocess.TimeoutExpired:
            kill(sp)
        time.sleep(0.1)
    finally:
        kill(cp)
        kill(sp)

    events = read_events(ctrace) + read_events(strace)
    if not events:
        raise RuntimeError("No events were recorded. Program output: " + " ".join(clog[-3:] + slog[-3:]))
    events.sort(key=lambda e: e["t"])
    t0 = events[0]["t"]
    for i, e in enumerate(events):
        e["i"] = i
        e["t"] = round(e["t"] - t0, 3)

    split = next((e for e in events if e["type"] == "file_split"), None)
    written = next((e for e in events if e["type"] == "file_written"), None)
    failed = next((e for e in events if e["type"] == "transfer_failed"), None)
    out_file = os.path.join(out_dir, sample)
    sha_in = hashlib.sha256(open(src, "rb").read()).hexdigest()
    sha_out = None
    if os.path.isfile(out_file):
        sha_out = hashlib.sha256(open(out_file, "rb").read()).hexdigest()
        RUN_DIRS[rid] = out_file
    summary = {
        "ok": bool(written and written.get("crc_ok") and sha_out == sha_in),
        "failed": bool(failed),
        "sample": sample,
        "sha_original": sha_in,
        "sha_rebuilt": sha_out,
        "sha_client_trace": split.get("sha256") if split else None,
        "sha_server_trace": written.get("sha256") if written else None,
        "options": {"loss": loss, "coded": coded, "topup": topup, "latency": latency, "jitter": jitter,
                    "ack_loss": ack_loss, "rate": rate, "seed": seed},
        "client_log": clog[-12:], "server_log": slog[-14:],
    }
    # prune old runs
    try:
        dirs = sorted((os.path.getmtime(os.path.join(RUNS, d)), d) for d in os.listdir(RUNS))
        for _, d in dirs[:-KEEP_RUNS]:
            shutil.rmtree(os.path.join(RUNS, d), ignore_errors=True)
            RUN_DIRS.pop(d, None)
    except OSError:
        pass
    return {"id": rid, "events": events, "summary": summary}


def collect_snippets():
    """Real source code between '// @snippet NAME' and '// @end' markers."""
    snippets = {}
    for fname in ("coding.cpp", "client.cpp", "server.cpp"):
        p = os.path.join(BACKEND, fname)
        if not os.path.isfile(p):
            continue
        name, buf = None, []
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                m = re.match(r"\s*//\s*@snippet\s+(\w+)", line)
                if m:
                    name, buf = m.group(1), []
                elif re.match(r"\s*//\s*@end", line):
                    if name:
                        lines = buf
                        indent = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
                        snippets[name] = {"file": fname, "code": "".join(l[indent:] for l in lines).rstrip() + "\n"}
                    name = None
                elif name is not None:
                    buf.append(line)
    return snippets


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "ErasureLab/1.0"

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/samples":
            ready = os.path.isfile(SERVER_BIN) and os.path.isfile(CLIENT_BIN)
            return self._json({"samples": list_samples(), "programs_ready": ready})
        if path == "/api/code":
            return self._json(collect_snippets())
        m = re.match(r"^/api/download/([0-9a-f]+)$", path)
        if m:
            f = RUN_DIRS.get(m.group(1))
            if not f or not os.path.isfile(f):
                return self._json({"error": "no rebuilt file for this run"}, 404)
            data = open(f, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % os.path.basename(f))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._static(path)

    def do_POST(self):
        if urlparse(self.path).path != "/api/run":
            return self._json({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            opts = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._json({"error": "bad request"}, 400)
        if not RUN_LOCK.acquire(False):
            return self._json({"error": "another transfer is still running"}, 409)
        try:
            self._json(do_run(opts))
        except Exception as e:                      # report any failure to the page
            self._json({"error": str(e)}, 500)
        finally:
            RUN_LOCK.release()

    def _static(self, path):
        if not os.path.isdir(DIST):
            body = (b"<h1>Frontend not found</h1><p>Expected the built app in frontend/dist.</p>")
            self.send_response(404)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(DIST, rel))
        if not full.startswith(os.path.normpath(DIST)) or not os.path.isfile(full):
            full = os.path.join(DIST, "index.html")        # single-page app fallback
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        data = open(full, "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    os.makedirs(RUNS, exist_ok=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://127.0.0.1:%d" % port
    print("Erasure-coded transfer lab running at " + url)
    if not (os.path.isfile(SERVER_BIN) and os.path.isfile(CLIENT_BIN)):
        print("NOTE: server/client programs not found. Build them first: build.bat (Windows) or sh build.sh")
    print("Press Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
