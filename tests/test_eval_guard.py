"""The evaluation quota guard counts today's earlier use (evaluations + visitors) and stops before the caps."""
import json
import time

from backend.agent import eval_guard as G
from backend.agent.quota import ProviderLimit, QuotaConfig, QuotaManager

M = "google:gemini-3.5-flash-lite"


def manager(now):
    lim = {M: ProviderLimit(key=M, rpm=15, tpm=250_000, rpd=500, daily_token_budget=800_000)}
    return QuotaManager(lim, QuotaConfig(), clock=lambda: now)


def write_run(root, name, started, rows):
    d = root / name
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"started": started}))
    (d / "results.jsonl").write_text("\n".join(json.dumps({"final": {"model": "gemini-3.5-flash-lite",
        "usage": {"requests": r, "input_tokens": t, "output_tokens": 0}}}) for r, t in rows))


def test_counts_only_todays_evaluation_runs(tmp_path):
    now = time.time()
    reset = G.last_reset(now)
    write_run(tmp_path, "a", time.strftime("%Y-%m-%d %H:%M", time.localtime(reset - 3600)), [(50, 100_000)])   # yesterday
    write_run(tmp_path, "b", time.strftime("%Y-%m-%d %H:%M", time.localtime(reset + 120)), [(3, 9000), (2, 6000)])
    assert G.local_usage(tmp_path, reset) == {M: {"requests": 5, "tokens": 15_000}}


def test_refuses_when_todays_use_plus_the_run_passes_the_cap():
    now = time.time()
    q = manager(now)
    caps = q.get(M).caps(demo=False)                 # public caps: 80% of 500 requests, minus the 15% reserve
    assert caps["rpd"] == 340 and caps["tokens_day"] == 680_000
    local, live = {M: {"requests": 300, "tokens": 600_000}}, {M: {"requests": 20, "tokens": 40_000}}
    p = G.plan(q, [M], local, live, need_requests=30, need_tokens=30_000)
    assert not p.ok and any("would pass the cap of 340" in x for x in p.lines)      # 320 + 30 > 340
    assert G.plan(q, [M], local, live, need_requests=15, need_tokens=30_000).ok    # 320 + 15 <= 340; 640k + 30k <= 680k
    p = G.plan(q, [M], {M: {"requests": 10, "tokens": 660_000}}, {}, need_requests=5, need_tokens=30_000)
    assert not p.ok and any("tokens would pass" in x for x in p.lines)


def test_seeded_use_counts_toward_the_daily_caps_but_not_the_minute():
    now = time.time()
    q = manager(now)
    G.seed(q, {M: {"requests": 320, "tokens": 640_000}}, now)
    u = q.get(M)._usage(now)
    assert u["req_day"] == 320 and u["tok_day"] == 640_000
    assert u["req_min"] == 0 or now - G.last_reset(now) < 120                     # not in this minute's window
    caps = q.get(M).caps(demo=False)
    assert q.get(M)._day_ok(u, caps, need_req=4, need_tok=12_000) is None          # room for one more question
    assert q.get(M)._day_ok(u, caps, need_req=40, need_tok=12_000) == "daily request limit"


def test_unreadable_live_usage_raises(monkeypatch):
    import pytest
    with pytest.raises(Exception):
        G.live_usage("http://127.0.0.1:9", timeout=1)
