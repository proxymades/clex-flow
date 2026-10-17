"""Run with the existing ESP-IDF Python. Uses only a local HTTP server."""
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import types

HOOKS = Path(__file__).resolve().parents[1] / "src-tauri/src/component_progress"
sys.path.insert(0, str(HOOKS))
import clex_component_progress as progress
progress.install()
from idf_component_tools.sources import web_service

payload = bytes(range(256)) * 2048
source_hash = hashlib.sha256(Path(web_service.__file__).read_bytes()).hexdigest()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        if self.path != "/unknown.zip":
            self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        data = payload[:len(payload)//2] if self.path == "/truncated.zip" else payload
        for start in range(0, len(data), 65536):
            self.wfile.write(data[start:start+65536])
            self.wfile.flush()
            time.sleep(0.16)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    for name in ["known", "unknown", "truncated"]:
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(output):
            # Compare against the same official downloader with observation disabled.
            baseline = web_service.download_file(f"http://127.0.0.1:{server.server_port}/{name}.zip", directory, filename="baseline.zip")
            expected = Path(baseline).read_bytes()
            reporter = progress.Reporter(types.SimpleNamespace(name="lvgl/lvgl", version="9.2.2"))
            progress._local.component = reporter
            failed = False
            try:
                result = web_service.download_file(f"http://127.0.0.1:{server.server_port}/{name}.zip", directory, filename="component.zip")
                assert Path(result).read_bytes() == expected
            except web_service.FetchingError:
                failed = True
            finally:
                progress._local.component = None
                reporter.close()
        messages = [json.loads(line[len(progress.PREFIX):]) for line in output.getvalue().splitlines() if line.startswith(progress.PREFIX)]
        downloads = [m for m in messages if m["phase"] == "download"]
        assert downloads, name
        assert any(0 < m["downloaded"] < len(payload) and m["speed"] > 0 for m in downloads), name
        assert not failed, name
        if name != "truncated":
            assert expected == payload
            assert downloads[-1]["complete"] and downloads[-1]["downloaded"] == len(payload), name
            assert downloads[-1]["total"] == (None if name == "unknown" else len(payload)), name
        else:
            assert len(expected) < len(payload)
            assert not downloads[-1]["complete"], name
        print(f"PASS: real Component Manager HTTP stream: {name}; payload and failure behavior preserved")
    assert hashlib.sha256(Path(web_service.__file__).read_bytes()).hexdigest() == source_hash
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
