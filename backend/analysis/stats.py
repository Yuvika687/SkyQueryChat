"""Small statistics used by the analysis functions. numpy and math only (no scipy in production); the tests check
each one against scipy.

- mann_kendall: trend test on time-ordered values (gaps are simply absent days), with tie correction.
- sens_slope: Theil-Sen slope over real time (days between observations), so gaps do not distort it.
- block_bootstrap_ci: approximate 95% range for a mean of daily values, resampling whole weeks because
  neighbouring days are correlated.
- spearman / spearman_ci: rank correlation and an approximate 95% range (Fisher z, Bonett-Wright standard error).
"""
from __future__ import annotations

import math
from datetime import date

import numpy as np

MIN_TREND_DAYS = 20
DAYS_PER_MONTH = 365.25 / 12
SHORT_PERIOD_DAYS = 90          # below this, a trend is reported as the total change over the period
SHORT_NOTE = "Short periods include seasonal change."


def _norm_cdf(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2))


def mann_kendall(values: list[float]) -> dict:
    """S, z and the two-sided p-value of the Mann-Kendall test (normal approximation with tie correction)."""
    x = np.asarray(values, dtype=float)
    n = len(x)
    if n < 3:
        return {"n": n, "s": 0, "z": 0.0, "p": 1.0}
    diff = np.sign(x[None, :] - x[:, None])
    s = int(np.triu(diff, 1).sum())
    _, counts = np.unique(x, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in counts if t > 1)) / 18
    z = 0.0 if s == 0 or var <= 0 else (s - np.sign(s)) / math.sqrt(var)
    return {"n": n, "s": s, "z": float(z), "p": float(2 * (1 - _norm_cdf(abs(z))))}


def sens_slope(days: list[float], values: list[float]) -> tuple[float, float]:
    """Theil-Sen slope (units per day) and intercept (median(y) - slope * median(t))."""
    t, y = np.asarray(days, dtype=float), np.asarray(values, dtype=float)
    i, j = np.triu_indices(len(t), 1)
    dt = t[j] - t[i]
    ok = dt != 0
    slope = float(np.median((y[j] - y[i])[ok] / dt[ok])) if ok.any() else 0.0
    return slope, float(np.median(y) - slope * np.median(t))


def trend(dates: list[date], values: list[float], start: date | None = None, end: date | None = None) -> dict:
    """Mann-Kendall + Sen's slope on daily values with a value. Direction only when p < 0.05.
    With the period (start, end): periods under 90 days also get the total change over the period (slope per day x
    (days in period - 1), i.e. along the fitted line from the first to the last day), which is the figure to report."""
    pairs = [(d, v) for d, v in zip(dates, values) if v is not None and not (isinstance(v, float) and math.isnan(v))]
    n = len(pairs)
    if n < MIN_TREND_DAYS:
        return {"status": "not enough data", "n_days": n, "min_days": MIN_TREND_DAYS}
    pairs.sort()
    t0 = pairs[0][0]
    days = [(d - t0).days for d, _ in pairs]
    vals = [v for _, v in pairs]
    mk = mann_kendall(vals)
    slope, _ = sens_slope(days, vals)
    per_month = slope * DAYS_PER_MONTH
    if mk["p"] >= 0.05:
        status = "no clear trend"
    else:
        status = "increasing" if mk["s"] > 0 else "decreasing"
    out = {"status": status, "n_days": n, "slope_per_month": per_month, "p_value": mk["p"], "mk_s": mk["s"],
           "method": "Mann-Kendall test with Sen's slope on daily city values (days without a value are left out)"}
    if start and end:
        days = (end - start).days + 1
        out["period_days"] = days
        if days < SHORT_PERIOD_DAYS:
            out["change_over_period"] = slope * (days - 1)
            out["note"] = SHORT_NOTE
    return out


def block_bootstrap_ci(dates: list[date], values: list[float], reps: int = 2000, seed: int = 7,
                       block_days: int = 7) -> tuple[float, float] | None:
    """Approximate 95% range for the mean of daily values: resample whole 7-day blocks with replacement.
    Deterministic (fixed seed) so the same data always gives the same range."""
    pairs = sorted((d, v) for d, v in zip(dates, values) if v is not None and not (isinstance(v, float) and math.isnan(v)))
    if len(pairs) < 2:
        return None
    t0 = pairs[0][0]
    blocks: dict[int, list[float]] = {}
    for d, v in pairs:
        blocks.setdefault((d - t0).days // block_days, []).append(v)
    sums = np.array([sum(b) for b in blocks.values()])
    counts = np.array([len(b) for b in blocks.values()])
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(sums), size=(reps, len(sums)))
    means = sums[idx].sum(axis=1) / counts[idx].sum(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return float(lo), float(hi)


def _ranks(a: np.ndarray) -> np.ndarray:
    order = a.argsort(kind="mergesort")
    r = np.empty(len(a))
    r[order] = np.arange(1, len(a) + 1)
    # average ranks for ties
    vals, inv, counts = np.unique(a, return_inverse=True, return_counts=True)
    sums = np.bincount(inv, weights=r)
    return (sums / counts)[inv]


def spearman(x: list[float], y: list[float]) -> float:
    xa, ya = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if len(xa) < 3:
        return float("nan")
    rx, ry = _ranks(xa), _ranks(ya)
    return float(np.corrcoef(rx, ry)[0, 1])


def spearman_ci(rho: float, n: int) -> tuple[float, float] | None:
    """Approximate 95% range for Spearman's rho: Fisher z with the Bonett-Wright standard error sqrt((1 + rho^2/2)/(n - 3))."""
    if n < 10 or math.isnan(rho) or abs(rho) >= 1:
        return None
    z = math.atanh(rho)
    se = math.sqrt((1 + rho * rho / 2) / (n - 3))
    return math.tanh(z - 1.96 * se), math.tanh(z + 1.96 * se)


def ranges_overlap_heavily(a: tuple[float, float], b: tuple[float, float], share: float = 0.5) -> bool:
    """True when two 95% ranges overlap by at least `share` of the narrower one ("too close to call")."""
    overlap = min(a[1], b[1]) - max(a[0], b[0])
    narrow = min(a[1] - a[0], b[1] - b[0])
    return overlap > 0 and (narrow <= 0 or overlap >= share * narrow)
