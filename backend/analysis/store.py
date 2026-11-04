"""Read-only data access over the app tables with DuckDB (no raw readings)."""
from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

APP_DIR = Path(__file__).resolve().parents[2] / "data" / "app"
TABLES = ["stations", "station_daily", "city_daily", "city_daily_aqi", "weather_daily", "date_quality",
          "network_gaps", "diwali_aqi_levels", "diwali_aqi_baselines", "delhi_pm_diwali_support",
          "diwali_pm_status", "data_status_reasons"]


class Store:
    def __init__(self, tables: dict[str, pd.DataFrame]):
        self.con = duckdb.connect()
        self.tables = tables
        for name, df in tables.items():
            self.con.register(name, df)

    @classmethod
    def from_dir(cls, app_dir: Path = APP_DIR) -> "Store":
        return cls({t: pd.read_parquet(app_dir / f"{t}.parquet") for t in TABLES
                    if (app_dir / f"{t}.parquet").exists()})

    def q(self, sql: str, params: list | None = None) -> pd.DataFrame:
        return self.con.execute(sql, params or []).df()
