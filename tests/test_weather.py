"""Weather parsing: IST local dates, units, attribution, preliminary flag; fails loudly."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from backend.pipeline import weather as W


def _resp(offset=19800, temp_unit="°C"):
    return {"latitude": 28.58, "longitude": 77.19, "utc_offset_seconds": offset,
            "daily_units": {"time": "iso8601", "temperature_2m_mean": temp_unit, "relative_humidity_2m_mean": "%",
                            "wind_speed_10m_mean": "km/h", "precipitation_sum": "mm"},
            "daily": {"time": ["2026-10-28", "2026-10-29"], "temperature_2m_mean": [24.1, None],
                      "relative_humidity_2m_mean": [60, 62], "wind_speed_10m_mean": [5.5, 6.0],
                      "precipitation_sum": [0.0, 1.2]}}


def test_parse_ist_dates_units_and_labels():
    df = W.parse("Delhi", _resp(), fetched_on=date(2026, 11, 4))
    assert list(df["local_date"]) == [date(2026, 10, 28), date(2026, 10, 29)]
    assert df["data_type"].unique().tolist() == ["modelled (reanalysis)"]
    assert "Open-Meteo.com" in df["attribution"].iat[0] and "CC BY 4.0" in df["attribution"].iat[0]
    assert pd.isna(df["temperature_mean_c"].iat[1])           # missing stays missing
    assert df["preliminary"].tolist() == [False, True]         # only dates < 7 days before fetch
    assert W.UNITS["precipitation_sum_mm"] == "mm"


def test_parse_rejects_non_ist_or_wrong_units():
    with pytest.raises(ValueError):
        W.parse("Delhi", _resp(offset=0), fetched_on=date(2026, 11, 4))
    with pytest.raises(ValueError):
        W.parse("Delhi", _resp(temp_unit="°F"), fetched_on=date(2026, 11, 4))


REAL = Path(__file__).resolve().parents[1] / "data" / "app" / "weather_daily.parquet"


@pytest.mark.skipif(not REAL.exists(), reason="app tables not built")
def test_real_weather_complete_and_separate():
    w = pd.read_parquet(REAL)
    assert set(w["city"]) == {"Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"}
    assert w["local_date"].min() == date(2025, 2, 18)
    assert not w.duplicated(["city", "local_date"]).any()
    assert not any(c.startswith(("pm", "aqi")) for c in w.columns)     # weather kept separate
    assert w[list(W.UNITS)].notna().all().all()
