"""Observe Component Manager downloads without replacing HTTP, extraction or validation."""
import collections
import functools
import importlib.abc
import importlib.machinery
import json
import sys
import threading
import time
import uuid

PREFIX = "__CLEX_COMPONENT_PROGRESS__"
_local = threading.local()
_output_lock = threading.Lock()


def _write(value):
    try:
        line = PREFIX + json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n"
        with _output_lock:
            sys.stdout.write(line)
            sys.stdout.flush()
    except Exception:
        pass


class Reporter:
    def __init__(self, component, phase="prepare"):
        self.component = str(component.name)[:128]
        self.version = str(component.version)[:64]
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.transferred = False
        self.begin(phase)
        self.thread = threading.Thread(target=self._heartbeat, daemon=True)
        self.thread.start()

    def begin(self, phase, kind="archive"):
        with self.lock:
            self.key = uuid.uuid4().hex
            self.phase = phase
            self.kind = kind
            self.downloaded = 0
            self.total = None
            self.complete = False
            self.last_data = time.monotonic()
            self.samples = collections.deque([(self.last_data, 0)])
            self.emit()

    def emit(self):
        with self.lock:
            now = time.monotonic()
            self.samples.append((now, self.downloaded))
            while len(self.samples) > 2 and self.samples[1][0] <= now - 5:
                self.samples.popleft()
            start, count = self.samples[0]
            elapsed = now - start
            stalled = int(now - self.last_data) if self.phase in ("prepare", "download") and not self.complete else 0
            speed = (self.downloaded - count) / elapsed if elapsed > 0 and stalled < 15 else 0
            _write({"v": 1, "id": self.key, "component": self.component,
                    "version": self.version, "phase": self.phase, "kind": self.kind,
                    "downloaded": self.downloaded, "total": self.total,
                    "speed": speed, "stalled": stalled, "complete": self.complete})

    def headers(self, response):
        with self.lock:
            try:
                size = int(response.headers.get("content-length", "0"))
                encoding = response.headers.get("content-encoding", "identity").lower()
                self.total = size if size > 0 and encoding == "identity" else None
            except (TypeError, ValueError, AttributeError):
                self.total = None
            self.last_data = time.monotonic()
            self.emit()

    def chunk(self, size):
        with self.lock:
            self.downloaded += size
            self.last_data = time.monotonic()

    def finish(self):
        with self.lock:
            self.complete = self.phase != "download" or self.total is None or self.downloaded == self.total
            self.emit()

    def close(self):
        self.stop.set()
        self.thread.join(timeout=2)

    def _heartbeat(self):
        while not self.stop.wait(1):
            self.emit()


def _observe_http(requests):
    session = requests.sessions.Session
    if getattr(session.send, "_clex_progress", False):
        return
    original = session.send

    @functools.wraps(original)
    def send(self, *args, **kwargs):
        response = original(self, *args, **kwargs)
        reporter = getattr(_local, "transfer", None)
        if reporter and kwargs.get("stream") and response.status_code == 200 and not getattr(response, "_clex_progress", False):
            response._clex_progress = True
            reporter.headers(response)
            chunks = response.iter_content

            def observed_chunks(*args, **kwargs):
                for chunk in chunks(*args, **kwargs):
                    if chunk:
                        reporter.chunk(len(chunk))
                    yield chunk

            response.iter_content = observed_chunks
        return response

    send._clex_progress = True
    session.send = send


def _web_service(module):
    source = module.WebServiceSource
    original_source = source.download
    original_file = module.download_file
    original_unpack = module.unpack_archive
    _observe_http(module.requests)

    @functools.wraps(original_source)
    def download(self, component, *args, **kwargs):
        try:
            reporter = Reporter(component)
        except Exception:
            return original_source(self, component, *args, **kwargs)
        previous = getattr(_local, "component", None)
        _local.component = reporter
        try:
            result = original_source(self, component, *args, **kwargs)
            if not reporter.transferred:
                reporter.begin("cached")
                reporter.finish()
            return result
        finally:
            _local.component = previous
            reporter.close()

    @functools.wraps(original_file)
    def download_file(*args, **kwargs):
        reporter = getattr(_local, "component", None)
        if not reporter:
            return original_file(*args, **kwargs)
        filename = kwargs.get("filename") or (args[2] if len(args) > 2 else "") or ""
        reporter.transferred = True
        reporter.begin("download", "checksums" if "checksum" in str(filename).lower() else "archive")
        previous = getattr(_local, "transfer", None)
        _local.transfer = reporter
        try:
            result = original_file(*args, **kwargs)
            reporter.finish()
            return result
        finally:
            if not reporter.complete:
                reporter.emit()
            _local.transfer = previous

    @functools.wraps(original_unpack)
    def unpack(*args, **kwargs):
        reporter = getattr(_local, "component", None)
        if reporter:
            reporter.begin("unpack")
        result = original_unpack(*args, **kwargs)
        if reporter:
            reporter.finish()
        return result

    source.download = download
    module.download_file = download_file
    module.unpack_archive = unpack


def _dependencies(module):
    original = module.dependency_validate

    @functools.wraps(original)
    def validate(component, download_path):
        if not component.source.downloadable or download_path is None:
            return original(component, download_path)
        try:
            reporter = Reporter(component, "verify")
        except Exception:
            return original(component, download_path)
        try:
            result = original(component, download_path)
            reporter.finish()
            return result
        finally:
            reporter.close()

    module.dependency_validate = validate


_targets = {"idf_component_tools.sources.web_service": _web_service,
            "idf_component_manager.dependencies": _dependencies}


class Observer(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        callback = _targets.get(fullname)
        if not callback:
            return None
        spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        if not spec or not spec.loader:
            return None
        original = spec.loader

        class Loader:
            def create_module(self, spec):
                create = getattr(original, "create_module", None)
                return create(spec) if create else None

            def exec_module(self, module):
                original.exec_module(module)
                try:
                    callback(module)
                except Exception:
                    # Unknown Component Manager versions retain their normal behavior.
                    pass

        spec.loader = Loader()
        return spec


def install():
    sys.meta_path.insert(0, Observer())
