-- ══════════════════════════════════════════════
-- ARTEMIS ALPHA — Supabase 数据表创建脚本
-- 在 Supabase SQL Editor 中运行此脚本
-- ══════════════════════════════════════════════

-- 交易日志
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  direction TEXT DEFAULT '做多',
  size TEXT,
  pnl TEXT DEFAULT '0',
  entry_price TEXT,
  exit_price TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 情绪追踪
CREATE TABLE IF NOT EXISTS moods (
  id TEXT PRIMARY KEY,
  mood INTEGER DEFAULT 3,
  confidence INTEGER DEFAULT 3,
  market_bias TEXT DEFAULT '中性',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 概率预测
CREATE TABLE IF NOT EXISTS forecasts (
  id TEXT PRIMARY KEY,
  ticker TEXT,
  event TEXT NOT NULL,
  probability INTEGER DEFAULT 50,
  timeframe TEXT,
  outcome TEXT DEFAULT '',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 市场笔记
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT,
  category TEXT DEFAULT '宏观',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 开放读写权限（个人项目，无需认证）
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE moods ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on trades" ON trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on moods" ON moods FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on forecasts" ON forecasts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on notes" ON notes FOR ALL USING (true) WITH CHECK (true);
