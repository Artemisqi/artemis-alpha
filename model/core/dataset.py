"""PyTorch Dataset: 滑动窗口构建训练样本"""

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

from model.data.features import normalize_window, get_feature_columns


class StockDataset(Dataset):
    """将特征DataFrame转为滑动窗口的PyTorch Dataset。

    每个样本:
        X: (window_size, n_features) — 归一化后的特征窗口
        y_dir: float — 次日方向 (1.0=涨, 0.0=跌)
        y_mag: float — 次日对数收益率
    """

    def __init__(self, features_df: pd.DataFrame, config: dict):
        self.window_size = config["features"]["window_size"]
        self.feature_cols = get_feature_columns(config)

        data = features_df[self.feature_cols].values.astype(np.float32)
        targets_dir = features_df["direction"].values.astype(np.float32)
        targets_mag = features_df["next_return"].values.astype(np.float32)

        self.windows = []
        self.dir_labels = []
        self.mag_labels = []

        for i in range(len(data) - self.window_size):
            window = data[i : i + self.window_size]
            window = normalize_window(window)
            self.windows.append(window)
            # 目标是窗口最后一天对应的next_return
            self.dir_labels.append(targets_dir[i + self.window_size - 1])
            self.mag_labels.append(targets_mag[i + self.window_size - 1])

        self.windows = np.array(self.windows)
        self.dir_labels = np.array(self.dir_labels)
        self.mag_labels = np.array(self.mag_labels)

    def __len__(self):
        return len(self.windows)

    def __getitem__(self, idx):
        return (
            torch.from_numpy(self.windows[idx]),
            torch.tensor(self.dir_labels[idx]),
            torch.tensor(self.mag_labels[idx]),
        )


def split_by_date(
    features_df: pd.DataFrame, train_end: str, val_end: str
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """按日期切分训练集和验证集，确保无未来数据泄漏"""
    train = features_df[features_df.index <= train_end]
    val = features_df[
        (features_df.index > train_end) & (features_df.index <= val_end)
    ]
    return train, val
