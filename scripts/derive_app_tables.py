"""Derive compact app tables (data/app) from data/processed. No downloads."""
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.pipeline import derive  # noqa: E402

t = time.time()
m = derive.run()
print(json.dumps({"rows": m["rows"], "total_MB": round(m["total_bytes"] / 1e6, 2)}, indent=1))
print(f"done in {time.time() - t:.0f}s")
