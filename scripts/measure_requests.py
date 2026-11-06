"""Measure model requests and tokens per question from saved evaluation runs (no API calls).

  python scripts/measure_requests.py            # prints a table, writes evals/request_stats.json

Requests are the provider calls Pydantic AI counted for each answered question (usage.requests).
Hidden SDK retries after a 429/5xx are not visible here. The capacity estimate uses the shared
limits in backend/config/models.json (after the safety margin and demo reserve).
"""
import json
import math
import statistics as S
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.agent.models import load_config  # noqa: E402
from backend.agent.quota import QuotaManager  # noqa: E402

RUNS = ROOT / "evals" / "runs"
CURRENT = ("20261105-1348_main_first", "20261105-1417_holdout_first")   # runs on the current agent code


def stats(rows):
    req = [r["final"]["usage"]["requests"] for r in rows if r["final"].get("usage", {}).get("requests")]
    tok = [r["final"]["usage"].get("input_tokens", 0) + r["final"]["usage"].get("output_tokens", 0)
           for r in rows if r["final"].get("usage", {}).get("requests")]
    if not req:
        return None
    srt = sorted(req)
    return {"questions": len(req), "requests_mean": round(S.mean(req), 2), "requests_median": S.median(req),
            "requests_p90": srt[math.ceil(0.9 * len(srt)) - 1], "requests_max": max(req),
            "distribution": {str(k): req.count(k) for k in sorted(set(req))},
            "tokens_per_question_mean": round(S.mean(tok)), "tokens_per_question_max": max(tok),
            "tokens_per_request_mean": round(sum(tok) / sum(req))}


def main():
    out, current_rows = {"runs": {}}, []
    for d in sorted(RUNS.iterdir()):
        f = d / "results.jsonl"
        if not f.exists():
            continue
        rows = [json.loads(x) for x in f.read_text().splitlines() if x.strip()]
        st = stats(rows)
        if st:
            out["runs"][d.name] = st
            if d.name in CURRENT:
                current_rows += rows
    cur = stats(current_rows)
    out["current_code"] = {"runs": list(CURRENT), **cur}
    qm = QuotaManager.from_config(load_config())
    cap = {}
    for k, pq in qm.models.items():
        c = pq.caps()
        per_q_req, per_q_tok = cur["requests_mean"], cur["tokens_per_question_mean"]
        by = [x for x in ((c["rpd"] and c["rpd"] / per_q_req), (c["tokens_day"] and c["tokens_day"] / per_q_tok)) if x]
        per_min = [x for x in ((c["rpm"] and c["rpm"] / per_q_req), (c["tpm"] and c["tpm"] / per_q_tok)) if x]
        cap[k] = {"public_caps": c, "questions_per_day_est": int(min(by)) if by else None,
                  "questions_per_minute_est": round(min(per_min), 1) if per_min else None}
    out["capacity_estimate"] = cap
    (ROOT / "evals" / "request_stats.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"{'run':38} {'n':>3} {'mean':>5} {'med':>4} {'p90':>4} {'max':>4} {'tok/q':>6} {'tok/req':>7}")
    for k, v in out["runs"].items():
        print(f"{k:38} {v['questions']:>3} {v['requests_mean']:>5} {v['requests_median']:>4} {v['requests_p90']:>4} "
              f"{v['requests_max']:>4} {v['tokens_per_question_mean']:>6} {v['tokens_per_request_mean']:>7}")
    print("current code:", {k: cur[k] for k in ("questions", "requests_mean", "requests_max", "distribution")})
    for k, v in cap.items():
        print(f"{k:32} public caps {v['public_caps']}  ~{v['questions_per_day_est']} questions/day, "
              f"~{v['questions_per_minute_est']}/min")


if __name__ == "__main__":
    main()
