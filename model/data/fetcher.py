"""数据获取: 通过yfinance下载美股/港股日线数据，本地缓存为parquet"""

import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

from model.utils.helpers import setup_logging, ensure_dir

log = setup_logging()


def fetch_ticker(
    ticker: str,
    start: str = "2018-01-01",
    end: str | None = None,
    cache_dir: str = "model/outputs/cache",
) -> pd.DataFrame:
    """下载单个ticker的OHLCV数据，缓存到本地parquet文件。

    缓存超过1天自动重新下载。
    """
    ensure_dir(cache_dir)
    safe_name = ticker.replace(".", "_")
    cache_path = Path(cache_dir) / f"{safe_name}.parquet"

    if end is None:
        end = datetime.now().strftime("%Y-%m-%d")

    # 检查缓存是否新鲜（1天内）
    if cache_path.exists():
        mtime = datetime.fromtimestamp(cache_path.stat().st_mtime)
        if datetime.now() - mtime < timedelta(days=1):
            log.info(f"[缓存] {ticker} — 使用本地缓存")
            return pd.read_parquet(cache_path)

    log.info(f"[下载] {ticker} — {start} → {end}")
    try:
        df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
    except Exception as e:
        log.error(f"[错误] {ticker} 下载失败: {e}")
        if cache_path.exists():
            log.warning(f"[回退] 使用旧缓存")
            return pd.read_parquet(cache_path)
        raise

    if df.empty:
        raise ValueError(f"{ticker} 返回空数据，请检查ticker是否正确")

    # 标准化列名
    df.columns = [c.lower() for c in df.columns]
    df.index.name = "date"

    # 处理多级列（yfinance有时返回MultiIndex）
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
        df.columns = [c.lower() for c in df.columns]

    df.to_parquet(cache_path)
    log.info(f"[完成] {ticker} — {len(df)} 条记录")
    return df


def fetch_all(config: dict) -> dict[str, pd.DataFrame]:
    """下载所有配置中的tickers"""
    tickers = config["data"]["us_tickers"] + config["data"]["hk_tickers"]
    start = config["data"]["start_date"]
    cache_dir = config["data"]["cache_dir"]

    results = {}
    for ticker in tickers:
        try:
            results[ticker] = fetch_ticker(ticker, start=start, cache_dir=cache_dir)
            time.sleep(0.5)  # 避免被yfinance限流
        except Exception as e:
            log.error(f"跳过 {ticker}: {e}")
    return results
