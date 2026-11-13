"""Every statistic checked against scipy (dev dependency) or a hand-worked result."""
import math
from datetime import date, timedelta

import numpy as np
import pytest

from backend.analysis import stats as S

scipy_stats = pytest.importorskip("scipy.stats")
RNG = np.random.default_rng(3)


def test_mann_kendall_matches_kendall_tau_against_time():
    y = list(np.round(RNG.normal(100, 20, 60) + np.arange(60) * 0.8, 1))
    mk = S.mann_kendall(y)
    tau = scipy_stats.kendalltau(np.arange(60), y, method="asymptotic")
    assert np.sign(mk["s"]) == np.sign(tau.statistic)
    assert mk["p"] == pytest.approx(tau.pvalue, rel=0.05)              # same test (continuity correction differs slightly)


def test_mann_kendall_hand_worked_and_ties():
    assert S.mann_kendall([1, 2, 3, 4, 5])["s"] == 10
    assert S.mann_kendall([5, 4, 3, 2, 1])["s"] == -10
    assert S.mann_kendall([3, 3, 3, 3])["p"] == 1.0


def test_sens_slope_matches_scipy_theilslopes_with_gaps():
    days = [0, 1, 2, 5, 6, 9, 10, 15, 20, 21]                          # gaps between days
    y = [10, 12, 11, 15, 16, 18, 19, 25, 30, 31.5]
    slope, intercept = S.sens_slope(days, y)
    ref = scipy_stats.theilslopes(y, days)
    assert slope == pytest.approx(ref.slope)
    assert intercept == pytest.approx(ref.intercept)


def test_trend_statuses():
    d0 = date(2026, 1, 1)
    dates = [d0 + timedelta(days=i) for i in range(60)]
    up = S.trend(dates, [50 + i * 1.0 for i in range(60)])
    assert up["status"] == "increasing" and up["slope_per_month"] == pytest.approx(365.25 / 12)
    flat = S.trend(dates, list(RNG.normal(80, 5, 60)))
    assert flat["status"] in ("no clear trend", "increasing", "decreasing") and 0 <= flat["p_value"] <= 1
    noisy = S.trend(dates, [80.0, 81.0] * 30)
    assert noisy["status"] == "no clear trend"
    assert S.trend(dates[:19], [1.0] * 19)["status"] == "not enough data"
    gappy = S.trend(dates, [None if i % 3 == 0 else 50 + i for i in range(60)])
    assert gappy["n_days"] == 40 and gappy["status"] == "increasing"


def test_block_bootstrap_range_is_deterministic_and_covers_the_mean():
    d0 = date(2026, 1, 1)
    dates = [d0 + timedelta(days=i) for i in range(90)]
    vals = list(RNG.normal(120, 30, 90))
    lo, hi = S.block_bootstrap_ci(dates, vals)
    assert lo < np.mean(vals) < hi and hi - lo < 60
    assert S.block_bootstrap_ci(dates, vals) == (lo, hi)                # fixed seed
    # blocks keep correlation: strongly autocorrelated data gives a wider range than shuffled data
    walk = list(np.cumsum(RNG.normal(0, 5, 90)) + 100)
    w = S.block_bootstrap_ci(dates, walk)
    shuffled = list(RNG.permutation(walk))
    s = S.block_bootstrap_ci(dates, shuffled)
    assert (w[1] - w[0]) > (s[1] - s[0])


def test_spearman_and_its_range():
    x = list(RNG.normal(0, 1, 200))
    y = [a * -0.6 + b for a, b in zip(x, RNG.normal(0, 1, 200))]
    rho = S.spearman(x, y)
    assert rho == pytest.approx(scipy_stats.spearmanr(x, y).statistic)
    lo, hi = S.spearman_ci(rho, 200)
    z, se = math.atanh(rho), math.sqrt((1 + rho ** 2 / 2) / 197)
    q = scipy_stats.norm.ppf(0.975)
    assert lo == pytest.approx(math.tanh(z - q * se), abs=1e-3) and hi == pytest.approx(math.tanh(z + q * se), abs=1e-3)
    assert lo < rho < hi < 0
    assert S.spearman([1, 2, 2, 3], [4, 4, 5, 6]) == pytest.approx(scipy_stats.spearmanr([1, 2, 2, 3], [4, 4, 5, 6]).statistic)
    assert S.spearman_ci(0.3, 8) is None


def test_too_close_to_call():
    assert S.ranges_overlap_heavily((100, 140), (110, 150))           # overlap 30 of width 40
    assert not S.ranges_overlap_heavily((100, 120), (118, 150))       # overlap 2 of width 20
    assert not S.ranges_overlap_heavily((100, 110), (120, 130))


def test_short_periods_report_the_total_change():
    d0 = date(2026, 10, 13)
    dates = [d0 + timedelta(days=i) for i in range(30)]
    t = S.trend(dates, [50 + 4.0 * i for i in range(30)], d0, d0 + timedelta(days=29))
    assert t["period_days"] == 30 and t["change_over_period"] == pytest.approx(4.0 * 29)
    assert t["note"] == "Short periods include seasonal change."
    long = S.trend(dates, [50 + 4.0 * i for i in range(30)], d0, d0 + timedelta(days=119))
    assert "change_over_period" not in long and long["period_days"] == 120
