"""Build-local startup hook. The installed SDK and Python packages stay untouched."""
import importlib.machinery
import importlib.util
import os
import sys


def _previous_customization():
    own = os.path.realpath(os.path.dirname(__file__))
    paths = [p for p in sys.path if os.path.realpath(p or os.curdir) != own]
    spec = importlib.machinery.PathFinder.find_spec("sitecustomize", paths)
    if spec and spec.loader:
        spec.loader.exec_module(importlib.util.module_from_spec(spec))


_previous_customization()

if os.environ.get("CLEX_COMPONENT_PROGRESS") == "1":
    try:
        from clex_component_progress import install
        install()
    except Exception:
        pass
