import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HOOKS = Path(__file__).resolve().parents[1] / "src-tauri/src/component_progress"
spec = importlib.util.spec_from_file_location("progress", HOOKS / "clex_component_progress.py")
progress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progress)
COMPONENT = types.SimpleNamespace(name="lvgl/lvgl", version="9.2.2", source=types.SimpleNamespace(downloadable=True))


def messages(output):
    return [json.loads(line[len(progress.PREFIX):]) for line in output.getvalue().splitlines() if line.startswith(progress.PREFIX)]


class ProgressTest(unittest.TestCase):
    def test_totals_stall_and_resume_use_real_received_bytes(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(progress.time, "monotonic", return_value=10) as clock:
            reporter = progress.Reporter(COMPONENT)
            try:
                reporter.begin("download")
                reporter.headers(types.SimpleNamespace(headers={"content-length": "10000"}))
                reporter.chunk(1024)
                clock.return_value = 30
                reporter.emit()
                stalled = messages(out)[-1]
                self.assertEqual((stalled["downloaded"], stalled["total"], stalled["stalled"], stalled["speed"]), (1024, 10000, 20, 0))
                reporter.chunk(512)
                reporter.emit()
                self.assertEqual(messages(out)[-1]["stalled"], 0)
                reporter.finish()
                self.assertFalse(messages(out)[-1]["complete"])
                reporter.chunk(10000 - 1536)
                reporter.finish()
                self.assertTrue(messages(out)[-1]["complete"])
            finally:
                reporter.close()

    def test_missing_and_compressed_lengths_are_unknown(self):
        with contextlib.redirect_stdout(io.StringIO()):
            reporter = progress.Reporter(COMPONENT)
            try:
                for headers in [{}, {"content-length": "bad"}, {"content-length": "-1"}, {"content-length": "100", "content-encoding": "gzip"}]:
                    reporter.headers(types.SimpleNamespace(headers=headers))
                    self.assertIsNone(reporter.total)
            finally:
                reporter.close()

    def test_http_observer_preserves_arguments_bytes_and_errors(self):
        calls = []

        class Response:
            status_code = 200
            headers = {"content-length": "6"}
            def iter_content(self, *args, **kwargs):
                calls.append((args, kwargs))
                yield b"abc"
                yield b"def"
                raise TimeoutError("original stream failure")

        class Session:
            def send(self, request, **kwargs):
                calls.append((request, kwargs))
                return Response()

        progress._observe_http(types.SimpleNamespace(sessions=types.SimpleNamespace(Session=Session)))
        with contextlib.redirect_stdout(io.StringIO()):
            reporter = progress.Reporter(COMPONENT)
            progress._local.transfer = reporter
            try:
                response = Session().send("original request", stream=True, verify=True)
                stream = response.iter_content(chunk_size=65536)
                self.assertEqual(next(stream), b"abc")
                self.assertEqual(next(stream), b"def")
                with self.assertRaisesRegex(TimeoutError, "original stream failure"):
                    next(stream)
                self.assertEqual(reporter.downloaded, 6)
                self.assertEqual(calls, [("original request", {"stream": True, "verify": True}), ((), {"chunk_size": 65536})])
            finally:
                progress._local.transfer = None
                reporter.close()

    def test_validation_errors_are_not_swallowed_or_reported_complete(self):
        def original(component, path):
            raise ValueError("checksum mismatch")
        module = types.SimpleNamespace(dependency_validate=original)
        progress._dependencies(module)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                module.dependency_validate(COMPONENT, "download directory")
        self.assertTrue(messages(out))
        self.assertTrue(all(item["phase"] == "verify" and not item["complete"] for item in messages(out)))

    def test_startup_preserves_existing_customization_and_ignores_unknown_manager_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "sitecustomize.py").write_text('import os\nos.environ["CLEX_PREVIOUS_TEST"]="yes"\n')
            package = root / "idf_component_tools/sources"
            package.mkdir(parents=True)
            (root / "idf_component_tools/__init__.py").write_text("")
            (package / "__init__.py").write_text("")
            (package / "web_service.py").write_text("VALUE=42\n")
            env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(HOOKS), tmp]), "CLEX_COMPONENT_PROGRESS": "1", "PYTHONDONTWRITEBYTECODE": "1"}
            result = subprocess.run([sys.executable, "-B", "-c", 'import os; from idf_component_tools.sources.web_service import VALUE; assert VALUE==42; assert os.environ["CLEX_PREVIOUS_TEST"]=="yes"; print("unchanged")'], env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "unchanged")


if __name__ == "__main__":
    unittest.main()
