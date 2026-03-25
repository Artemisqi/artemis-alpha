"""Walk-Forward训练器: 时间序列专用验证策略

核心逻辑:
    |------ train (24月) ------|-- val (3月) --|
                  |------ train (24月) ------|-- val (3月) --|
                                |------ train (24月) ------|-- val (3月) --|
"""

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from model.core.dataset import StockDataset, split_by_date
from model.core.model import build_model
from model.data.features import get_feature_columns
from model.utils.helpers import setup_logging, get_device, set_seed, ensure_dir

log = setup_logging()


class WalkForwardTrainer:
    def __init__(self, config: dict, features_df: pd.DataFrame, ticker: str):
        self.config = config
        self.features_df = features_df
        self.ticker = ticker
        self.device = get_device()
        self.input_size = len(get_feature_columns(config))

        tc = config["training"]
        self.epochs = tc["epochs"]
        self.batch_size = tc["batch_size"]
        self.lr = tc["learning_rate"]
        self.weight_decay = tc["weight_decay"]
        self.patience = tc["patience"]
        self.dir_weight = tc["direction_weight"]
        self.mag_weight = tc["magnitude_weight"]

        wf = tc["walk_forward"]
        self.train_months = wf["train_months"]
        self.val_months = wf["val_months"]
        self.step_months = wf["step_months"]

    def _generate_folds(self) -> list[tuple[str, str, str]]:
        """生成walk-forward的日期折叠 (train_start, train_end, val_end)"""
        dates = self.features_df.index
        min_date = dates.min()
        max_date = dates.max()

        folds = []
        train_start = min_date

        while True:
            train_end = train_start + pd.DateOffset(months=self.train_months)
            val_end = train_end + pd.DateOffset(months=self.val_months)

            if val_end > max_date:
                break

            folds.append((
                train_start.strftime("%Y-%m-%d"),
                train_end.strftime("%Y-%m-%d"),
                val_end.strftime("%Y-%m-%d"),
            ))
            train_start += pd.DateOffset(months=self.step_months)

        return folds

    def _train_one_epoch(self, model, loader, optimizer, bce, mse):
        model.train()
        total_loss = 0
        for X, y_dir, y_mag in loader:
            X = X.to(self.device)
            y_dir = y_dir.to(self.device)
            y_mag = y_mag.to(self.device)

            optimizer.zero_grad()
            pred_dir, pred_mag = model(X)
            loss = (
                self.dir_weight * bce(pred_dir, y_dir)
                + self.mag_weight * mse(pred_mag, y_mag)
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += loss.item() * len(X)
        return total_loss / len(loader.dataset)

    @torch.no_grad()
    def _evaluate(self, model, loader, bce, mse) -> dict:
        model.eval()
        total_loss = 0
        all_pred_dir, all_true_dir = [], []
        all_pred_mag, all_true_mag = [], []

        for X, y_dir, y_mag in loader:
            X = X.to(self.device)
            y_dir = y_dir.to(self.device)
            y_mag = y_mag.to(self.device)

            pred_dir, pred_mag = model(X)
            loss = (
                self.dir_weight * bce(pred_dir, y_dir)
                + self.mag_weight * mse(pred_mag, y_mag)
            )
            total_loss += loss.item() * len(X)

            all_pred_dir.append((pred_dir > 0.5).cpu().numpy())
            all_true_dir.append(y_dir.cpu().numpy())
            all_pred_mag.append(pred_mag.cpu().numpy())
            all_true_mag.append(y_mag.cpu().numpy())

        pred_dir = np.concatenate(all_pred_dir)
        true_dir = np.concatenate(all_true_dir)
        pred_mag = np.concatenate(all_pred_mag)
        true_mag = np.concatenate(all_true_mag)

        accuracy = (pred_dir == true_dir).mean()

        # 策略收益: 预测涨就做多，跌就空仓
        strategy_returns = pred_dir * true_mag
        if len(strategy_returns) > 1 and strategy_returns.std() > 0:
            sharpe = strategy_returns.mean() / strategy_returns.std() * np.sqrt(252)
        else:
            sharpe = 0.0

        return {
            "loss": total_loss / len(loader.dataset),
            "accuracy": float(accuracy),
            "sharpe": float(sharpe),
            "mse": float(np.mean((pred_mag - true_mag) ** 2)),
        }

    def run(self) -> list[dict]:
        """运行完整的walk-forward训练，返回各折指标"""
        set_seed(42)
        folds = self._generate_folds()
        log.info(f"[{self.ticker}] Walk-Forward: {len(folds)} 折")

        all_metrics = []
        best_val_loss = float("inf")
        checkpoint_dir = self.config["predict"]["checkpoint_dir"]
        ensure_dir(checkpoint_dir)

        for i, (train_start, train_end, val_end) in enumerate(folds):
            log.info(f"  折 {i+1}/{len(folds)}: train→{train_end}, val→{val_end}")

            train_df, val_df = split_by_date(self.features_df, train_end, val_end)
            # train_df还需要从train_start开始
            train_df = train_df[train_df.index >= train_start]

            if len(train_df) < self.config["features"]["window_size"] + 10:
                log.warning(f"  折 {i+1} 训练数据不足，跳过")
                continue
            if len(val_df) < self.config["features"]["window_size"] + 5:
                log.warning(f"  折 {i+1} 验证数据不足，跳过")
                continue

            train_ds = StockDataset(train_df, self.config)
            val_ds = StockDataset(val_df, self.config)

            if len(train_ds) == 0 or len(val_ds) == 0:
                continue

            train_loader = DataLoader(
                train_ds, batch_size=self.batch_size, shuffle=True, drop_last=False
            )
            val_loader = DataLoader(
                val_ds, batch_size=self.batch_size, shuffle=False
            )

            model = build_model(self.config, self.input_size).to(self.device)
            optimizer = torch.optim.AdamW(
                model.parameters(), lr=self.lr, weight_decay=self.weight_decay
            )
            scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
                optimizer, mode="min", factor=0.5, patience=3
            )
            bce = nn.BCELoss()
            mse = nn.MSELoss()

            best_fold_loss = float("inf")
            no_improve = 0

            for epoch in range(self.epochs):
                train_loss = self._train_one_epoch(
                    model, train_loader, optimizer, bce, mse
                )
                val_metrics = self._evaluate(model, val_loader, bce, mse)
                scheduler.step(val_metrics["loss"])

                if val_metrics["loss"] < best_fold_loss:
                    best_fold_loss = val_metrics["loss"]
                    no_improve = 0
                    # 保存全局最优checkpoint
                    if val_metrics["loss"] < best_val_loss:
                        best_val_loss = val_metrics["loss"]
                        ckpt_path = f"{checkpoint_dir}/{self.ticker.replace('.', '_')}_best.pt"
                        torch.save(model.state_dict(), ckpt_path)
                else:
                    no_improve += 1
                    if no_improve >= self.patience:
                        log.info(
                            f"    早停 @ epoch {epoch+1}, "
                            f"acc={val_metrics['accuracy']:.3f}, "
                            f"sharpe={val_metrics['sharpe']:.2f}"
                        )
                        break

            val_metrics["fold"] = i + 1
            val_metrics["train_end"] = train_end
            val_metrics["val_end"] = val_end
            all_metrics.append(val_metrics)

            log.info(
                f"    最终: loss={val_metrics['loss']:.4f}, "
                f"acc={val_metrics['accuracy']:.3f}, "
                f"sharpe={val_metrics['sharpe']:.2f}"
            )

        # 保存指标汇总
        if all_metrics:
            metrics_path = f"{checkpoint_dir}/{self.ticker.replace('.', '_')}_metrics.json"
            with open(metrics_path, "w") as f:
                json.dump(all_metrics, f, indent=2)
            avg_acc = np.mean([m["accuracy"] for m in all_metrics])
            avg_sharpe = np.mean([m["sharpe"] for m in all_metrics])
            log.info(
                f"[{self.ticker}] 平均: acc={avg_acc:.3f}, sharpe={avg_sharpe:.2f}"
            )

        return all_metrics

    def train_final(self):
        """用全部数据训练最终模型"""
        set_seed(42)
        log.info(f"[{self.ticker}] 训练最终模型（全量数据）...")

        dataset = StockDataset(self.features_df, self.config)
        loader = DataLoader(
            dataset, batch_size=self.batch_size, shuffle=True, drop_last=False
        )

        model = build_model(self.config, self.input_size).to(self.device)
        optimizer = torch.optim.AdamW(
            model.parameters(), lr=self.lr, weight_decay=self.weight_decay
        )
        bce = nn.BCELoss()
        mse = nn.MSELoss()

        for epoch in range(self.epochs):
            loss = self._train_one_epoch(model, loader, optimizer, bce, mse)
            if (epoch + 1) % 10 == 0:
                log.info(f"    epoch {epoch+1}/{self.epochs}, loss={loss:.4f}")

        checkpoint_dir = self.config["predict"]["checkpoint_dir"]
        ensure_dir(checkpoint_dir)
        ckpt_path = f"{checkpoint_dir}/{self.ticker.replace('.', '_')}_final.pt"
        torch.save(model.state_dict(), ckpt_path)
        log.info(f"[{self.ticker}] 最终模型已保存: {ckpt_path}")
