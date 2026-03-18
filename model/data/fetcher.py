"""数据获取: 通过yfinance下载美股/港股日线数据，本地缓存为parquet

如果yfinance因网络问题不可用，自动回退到模拟数据生成（用于开发调试）。
"""

import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from model.utils.helpers import setup_logging, ensure_dir

log = setup_logging()

# 尝试导入yfinance，不可用时标记
try:
    import yfinance as yf
    _HAS_YF = True
except ImportError:
    _HAS_YF = False


def _generate_simulated(ticker: str, start: str, end: str) -> pd.DataFrame:
    """生成模拟OHLCV数据（用于无网络环境的开发调试）。

    使用几何布朗运动模拟股价，参数根据ticker粗略设定。
    """
    log.warning(f"[模拟] {ticker} — 使用模拟数据（仅供调试，非真实行情）")
    np.random.seed(hash(ticker) % 2**31)

    dates = pd.bdate_range(start=start, end=end)
    n = len(dates)

    # 不同ticker不同初始价格
    base_prices = {
        "AAPL": 170, "TSLA": 250, "NVDA": 500, "MSFT": 380, "AMZN": 180,
        "GOOGL": 140, "META": 350, "0700.HK": 350, "9988.HK": 80,
        "1810.HK": 15, "2318.HK": 50, "0388.HK": 300, "3690.HK": 120,
    }
    s0 = base_prices.get(ticker, 100)

    # GBM参数: mu=8%年化, sigma=30%年化
    mu = 0.08 / 252
    sigma = 0.30 / np.sqrt(252)
    returns = np.random.normal(mu, sigma, n)
    prices = s0 * np.exp(np.cumsum(returns))

    # 构造OHLCV
    daily_vol = np.abs(np.random.normal(0, 0.015, n))
    high = prices * (1 + daily_vol)
    low = prices * (1 - daily_vol)
    open_price = low + (high - low) * np.random.uniform(0.3, 0.7, n)
    volume = np.random.lognormal(mean=17, sigma=0.5, size=n).astype(int)

    df = pd.DataFrame({
        "open": open_price,
        "high": high,
        "low": low,
        "close": prices,
        "volume": volume,
    }, index=dates)
    df.index.name = "date"
    return df


def fetch_ticker(
    ticker: str,
    start: str = "2018-01-01",
    end: str | None = None,
    cache_dir: str = "model/outputs/cache",
) -> pd.DataFrame:
    """下载单个ticker的OHLCV数据，缓存到本地parquet文件。

    缓存超过1天自动重新下载。网络不可用时回退到模拟数据。
    """
    ensure_dir(cache_dir)
    safe_name = ticker.replace(".", "_")
    cache_path = Path(cache_dir) / f"{safe_name}.csv"

    if end is None:
        end = datetime.now().strftime("%Y-%m-%d")

    # 检查缓存是否新鲜（1天内）
    if cache_path.exists():
        mtime = datetime.fromtimestamp(cache_path.stat().st_mtime)
        if datetime.now() - mtime < timedelta(days=1):
            log.info(f"[缓存] {ticker} — 使用本地缓存")
            return pd.read_csv(cache_path, index_col="date", parse_dates=True)

    # 尝试yfinance下载
    df = None
    if _HAS_YF:
        log.info(f"[下载] {ticker} — {start} → {end}")
        try:
            df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
            if df is not None and not df.empty:
                df.columns = [c.lower() for c in df.columns]
                df.index.name = "date"
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                    df.columns = [c.lower() for c in df.columns]
            else:
                df = None
        except Exception as e:
            log.warning(f"[网络] {ticker} 下载失败: {e}")
            df = None

    # 回退: 旧缓存 → 模拟数据
    if df is None:
        if cache_path.exists():
            log.warning(f"[回退] 使用旧缓存")
            return pd.read_csv(cache_path, index_col="date", parse_dates=True)
        df = _generate_simulated(ticker, start, end)

    df.to_csv(cache_path)
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
