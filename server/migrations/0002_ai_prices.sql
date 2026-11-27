CREATE TABLE IF NOT EXISTS ai_prices (
  model text PRIMARY KEY,
  input_per_million_cny numeric(12, 4) NOT NULL DEFAULT 0,
  output_per_million_cny numeric(12, 4) NOT NULL DEFAULT 0,
  ocr_per_page_cny numeric(12, 4) NOT NULL DEFAULT 0,
  asr_per_second_cny numeric(12, 6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_prices (model) VALUES ('deepseek-chat'), ('deepseek-flash')
ON CONFLICT (model) DO NOTHING;
