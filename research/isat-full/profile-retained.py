"""Compatibility entry point for the shared cross-game V8 profile reporter."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).parents[1] / 'pmjs-performance/profile-report.py'), run_name='__main__')
