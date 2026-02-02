-- Activity sessions (compressed from Tracks raw data)
-- Each session represents a contiguous period of same app/url/window/activity_type
CREATE TABLE activity_session (
  session_id SERIAL PRIMARY KEY,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  app TEXT NOT NULL,
  window_title TEXT DEFAULT '',
  url_id INTEGER REFERENCES url(url_id),
  site TEXT DEFAULT '',
  activity_type TEXT NOT NULL CHECK (activity_type IN ('active', 'idle', 'meeting')),
  duration_seconds INTEGER GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_at - start_at))::INTEGER
  ) STORED,
  doc_id INTEGER REFERENCES document(doc_id),
  source_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_time ON activity_session(start_at, end_at);
CREATE INDEX idx_session_app ON activity_session(app);
CREATE INDEX idx_session_date ON activity_session(source_date);
CREATE INDEX idx_session_doc ON activity_session(doc_id) WHERE doc_id IS NOT NULL;
CREATE INDEX idx_session_url ON activity_session(url_id) WHERE url_id IS NOT NULL;

-- Import tracking to prevent duplicate imports and enable incremental sync
CREATE TABLE tracks_import (
  import_id SERIAL PRIMARY KEY,
  source_file TEXT NOT NULL,
  file_date DATE NOT NULL UNIQUE,
  rows_imported INTEGER NOT NULL,
  sessions_created INTEGER NOT NULL,
  last_row_ts TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
