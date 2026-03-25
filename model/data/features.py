"""特征工程: 技术指标计算 + 归一化

所有指标用纯pandas/numpy实现，不依赖ta-lib。
归一化采用窗口内z-score，避免look-ahead bias。
"""

import numpy as np
import pandas as pd


def compute_features(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """从原始OHLCV计算全部特征 + 目标变量。

    返回的DataFrame每行包含:
    - 归一化的量价特征
    - 技术指标
    - 目标: next_return (次日对数收益率)
    - 目标: direction (1=涨, 0=跌)
    """
    feat = config["features"]
    out = pd.DataFrame(index=df.index)

    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    volume = df["volume"].astype(float)

    # ── 收益率 ──
    out["log_return_1d"] = np.log(close / close.shift(1))
    out["log_return_5d"] = np.log(close / close.shift(5))

    # ── 均线偏离率 ──
    for p in feat["ma_periods"]:
        ma = close.rolling(p).mean()
        out[f"ma{p}_ratio"] = (close - ma) / ma

    # ── RSI ──
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(feat["rsi_period"]).mean()
    loss = (-delta.clip(upper=0)).rolling(feat["rsi_period"]).mean()
    rs = gain / loss.replace(0, np.nan)
    out["rsi"] = 1 - 1 / (1 + rs)

    # ── MACD ──
    ema_fast = close.ewm(span=feat["macd_fast"], adjust=False).mean()
    ema_slow = close.ewm(span=feat["macd_slow"], adjust=False).mean()
    macd_line = ema_fast - ema_slow
    macd_signal = macd_line.ewm(span=feat["macd_signal"], adjust=False).mean()
    macd_hist = macd_line - macd_signal
    # 归一化: 除以收盘价
    out["macd_line"] = macd_line / close
    out["macd_signal"] = macd_signal / close
    out["macd_hist"] = macd_hist / close

    # ── 布林带位置 ──
    bb_ma = close.rolling(feat["bollinger_period"]).mean()
    bb_std = close.rolling(feat["bollinger_period"]).std()
    bb_upper = bb_ma + feat["bollinger_std"] * bb_std
    bb_lower = bb_ma - feat["bollinger_std"] * bb_std
    out["bb_position"] = (close - bb_lower) / (bb_upper - bb_lower).replace(0, np.nan)

    # ── 量比 ──
    out["volume_ratio_5d"] = volume / volume.rolling(5).mean().replace(0, np.nan)
    out["volume_ratio_20d"] = volume / volume.rolling(20).mean().replace(0, np.nan)

    # ── 振幅 ──
    out["amplitude"] = (high - low) / close

    # ── 目标变量 ──
    out["next_return"] = out["log_return_1d"].shift(-1)
    out["direction"] = (out["next_return"] > 0).astype(float)

    # 删除NaN行
    out.dropna(inplace=True)

    return out


def normalize_window(window: np.ndarray) -> np.ndarray:
    """窗口内z-score归一化。每个特征独立。

    Args:
        window: shape (seq_len, n_features)
    Returns:
        归一化后的window，shape不变
    """
    mean = window.mean(axis=0, keepdims=True)
    std = window.std(axis=0, keepdims=True)
    std = np.where(std < 1e-8, 1.0, std)
    return (window - mean) / std


def get_feature_columns(config: dict) -> list[str]:
    """返回模型输入特征的列名列表（不含目标变量）"""
    feat = config["features"]
    cols = ["log_return_1d", "log_return_5d"]
    cols += [f"ma{p}_ratio" for p in feat["ma_periods"]]
    cols += ["rsi", "macd_line", "macd_signal", "macd_hist"]
    cols += ["bb_position", "volume_ratio_5d", "volume_ratio_20d", "amplitude"]
    return cols
