"""LSTM + Multi-Head Attention 量价预测模型

架构:
    Input (batch, seq_len, n_features)
        → LSTM (双层, hidden=128, dropout=0.3)
        → Multi-Head Self-Attention (4 heads)
        → FC layers
        → direction_head (sigmoid) + magnitude_head (linear)
"""

import torch
import torch.nn as nn


class StockPredictor(nn.Module):
    def __init__(
        self,
        input_size: int,
        hidden_size: int = 128,
        num_layers: int = 2,
        dropout: float = 0.3,
        attention_heads: int = 4,
    ):
        super().__init__()

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
        )

        self.attention = nn.MultiheadAttention(
            embed_dim=hidden_size,
            num_heads=attention_heads,
            dropout=dropout,
            batch_first=True,
        )
        self.attn_norm = nn.LayerNorm(hidden_size)

        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, 32),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # 双头输出
        self.direction_head = nn.Sequential(nn.Linear(32, 1), nn.Sigmoid())
        self.magnitude_head = nn.Linear(32, 1)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            x: (batch, seq_len, n_features)
        Returns:
            direction: (batch, 1) — P(次日上涨)
            magnitude: (batch, 1) — 预测次日收益率
        """
        # LSTM编码
        lstm_out, _ = self.lstm(x)  # (batch, seq_len, hidden)

        # Self-Attention: 让模型学习哪些时间步最重要
        attn_out, _ = self.attention(lstm_out, lstm_out, lstm_out)
        attn_out = self.attn_norm(attn_out + lstm_out)  # 残差连接

        # 取最后一个时间步的表示
        last = attn_out[:, -1, :]  # (batch, hidden)

        # 全连接
        h = self.fc(last)

        direction = self.direction_head(h)
        magnitude = self.magnitude_head(h)

        return direction.squeeze(-1), magnitude.squeeze(-1)


def build_model(config: dict, input_size: int) -> StockPredictor:
    """根据配置构建模型"""
    mc = config["model"]
    return StockPredictor(
        input_size=input_size,
        hidden_size=mc["hidden_size"],
        num_layers=mc["num_layers"],
        dropout=mc["dropout"],
        attention_heads=mc["attention_heads"],
    )
