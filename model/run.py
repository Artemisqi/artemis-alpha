#!/usr/bin/env python3
"""ARTEMIS ALPHA — 量价深度学习模型 CLI

用法:
    python -m model.run fetch                     # 下载全部ticker数据
    python -m model.run train --ticker AAPL        # Walk-Forward训练单只
    python -m model.run train --all                # 训练全部ticker
    python -m model.run predict --ticker AAPL      # 预测次日走势
    python -m model.run predict --all              # 预测全部，输出CSV
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from model.utils.helpers import load_config, setup_logging, get_device, set_seed, ensure_dir
from model.data.fetcher import fetch_ticker, fetch_all
from model.data.features import compute_features, normalize_window, get_feature_columns
from model.core.dataset import StockDataset
from model.core.model import build_model
from model.core.trainer import WalkForwardTrainer

log = setup_logging()


def cmd_fetch(args, config):
    """下载数据"""
    if args.ticker:
        fetch_ticker(args.ticker, start=config["data"]["start_date"],
                     cache_dir=config["data"]["cache_dir"])
    else:
        fetch_all(config)
    log.info("数据下载完成")


def cmd_train(args, config):
    """训练模型"""
    tickers = _resolve_tickers(args, config)

    for ticker in tickers:
        log.info(f"{'═' * 50}")
        log.info(f"训练: {ticker}")
        log.info(f"{'═' * 50}")

        df = fetch_ticker(ticker, start=config["data"]["start_date"],
                         cache_dir=config["data"]["cache_dir"])
        features_df = compute_features(df, config)
        log.info(f"特征矩阵: {features_df.shape}")

        trainer = WalkForwardTrainer(config, features_df, ticker)
        metrics = trainer.run()

        if not metrics:
            log.warning(f"{ticker}: 无有效折叠，跳过最终模型训练")
            continue

        # 用全量数据训练最终版
        trainer.train_final()


def cmd_predict(args, config):
    """预测次日走势"""
    tickers = _resolve_tickers(args, config)
    device = get_device()
    results = []

    for ticker in tickers:
        try:
            result = _predict_single(ticker, config, device)
            results.append(result)
            direction = "📈 看涨" if result["direction"] == "UP" else "📉 看跌"
            log.info(
                f"{ticker}: {direction} | "
                f"概率={result['up_prob']:.1%} | "
                f"预测收益={result['predicted_return']:.2%}"
            )
        except Exception as e:
            log.error(f"{ticker}: 预测失败 — {e}")

    if results:
        output_dir = config["predict"]["output_dir"]
        ensure_dir(output_dir)
        df = pd.DataFrame(results)
        out_path = f"{output_dir}/prediction_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        df.to_csv(out_path, index=False)
        log.info(f"预测结果已保存: {out_path}")
        print("\n" + df.to_string(index=False))


def _predict_single(ticker: str, config: dict, device: torch.device) -> dict:
    """单只股票预测"""
    checkpoint_dir = config["predict"]["checkpoint_dir"]
    safe_name = ticker.replace(".", "_")

    # 优先用final模型，没有则用best
    ckpt_path = Path(f"{checkpoint_dir}/{safe_name}_final.pt")
    if not ckpt_path.exists():
        ckpt_path = Path(f"{checkpoint_dir}/{safe_name}_best.pt")
    if not ckpt_path.exists():
        raise FileNotFoundError(f"未找到 {ticker} 的模型checkpoint")

    # 获取最新数据
    df = fetch_ticker(ticker, start=config["data"]["start_date"],
                     cache_dir=config["data"]["cache_dir"])
    features_df = compute_features(df, config)
    feature_cols = get_feature_columns(config)
    input_size = len(feature_cols)

    # 取最后一个窗口
    window_size = config["features"]["window_size"]
    if len(features_df) < window_size:
        raise ValueError(f"数据不足: 需要 {window_size} 天，只有 {len(features_df)} 天")

    window = features_df[feature_cols].values[-window_size:].astype(np.float32)
    window = normalize_window(window)
    X = torch.from_numpy(window).unsqueeze(0).to(device)

    # 加载模型
    model = build_model(config, input_size).to(device)
    model.load_state_dict(torch.load(ckpt_path, map_location=device, weights_only=True))
    model.eval()

    with torch.no_grad():
        dir_prob, mag = model(X)

    up_prob = dir_prob.item()
    predicted_return = mag.item()

    return {
        "ticker": ticker,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "direction": "UP" if up_prob > 0.5 else "DOWN",
        "up_prob": up_prob,
        "predicted_return": predicted_return,
        "model_path": str(ckpt_path),
    }


def _resolve_tickers(args, config) -> list[str]:
    if hasattr(args, "ticker") and args.ticker:
        return [args.ticker]
    return config["data"]["us_tickers"] + config["data"]["hk_tickers"]


def main():
    parser = argparse.ArgumentParser(description="ARTEMIS ALPHA 量价深度学习模型")
    sub = parser.add_subparsers(dest="command", required=True)

    # fetch
    p_fetch = sub.add_parser("fetch", help="下载股票数据")
    p_fetch.add_argument("--ticker", type=str, help="指定单个ticker")

    # train
    p_train = sub.add_parser("train", help="训练模型")
    p_train.add_argument("--ticker", type=str, help="训练单个ticker")
    p_train.add_argument("--all", action="store_true", help="训练全部ticker")

    # predict
    p_pred = sub.add_parser("predict", help="预测次日走势")
    p_pred.add_argument("--ticker", type=str, help="预测单个ticker")
    p_pred.add_argument("--all", action="store_true", help="预测全部ticker")

    args = parser.parse_args()
    config = load_config()

    set_seed(42)

    if args.command == "fetch":
        cmd_fetch(args, config)
    elif args.command == "train":
        cmd_train(args, config)
    elif args.command == "predict":
        cmd_predict(args, config)


if __name__ == "__main__":
    main()
