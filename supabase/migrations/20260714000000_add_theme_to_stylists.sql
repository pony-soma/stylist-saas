-- スタイリストごとのテーマ設定を保存するためのカラム追加
ALTER TABLE stylists ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'system';
