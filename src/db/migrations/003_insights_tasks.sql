-- Phase 5: Proactive Insights & Tasks
-- Adds pattern detection storage, task management, and search logging

-- Insight types for pattern detection
CREATE TABLE insight (
  insight_id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN (
    'open_loop',           -- visited 1-2 times, not touched in 7+ days
    'repeated_search',     -- similar queries with low resolution
    'stale_topic',         -- high-score tags not touched in 14+ days
    'context_switch',      -- frequent app changes in short windows
    'research_thread',     -- connected documents forming a research trail
    'reading_spike'        -- sudden increase in activity on a topic
  )),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',          -- just detected
    'acknowledged', -- user has seen it
    'dismissed',    -- user explicitly dismissed
    'resolved'      -- pattern no longer active or addressed
  )),

  -- Confidence and priority
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),

  -- Human-readable summary
  title TEXT NOT NULL,
  description TEXT,
  suggestion TEXT,  -- actionable recommendation

  -- Related entities (polymorphic references via arrays)
  doc_ids INTEGER[] DEFAULT '{}',
  url_ids INTEGER[] DEFAULT '{}',
  tag_ids INTEGER[] DEFAULT '{}',
  chunk_ids INTEGER[] DEFAULT '{}',
  session_ids INTEGER[] DEFAULT '{}',
  search_log_ids INTEGER[] DEFAULT '{}',

  -- Flexible metadata
  metadata JSONB DEFAULT '{}',

  -- Caching timestamps
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,  -- NULL = never expires
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insight_type ON insight(type);
CREATE INDEX idx_insight_status ON insight(status);
CREATE INDEX idx_insight_expires ON insight(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_insight_priority ON insight(priority, detected_at DESC);
CREATE INDEX idx_insight_doc_ids ON insight USING GIN(doc_ids);
CREATE INDEX idx_insight_tag_ids ON insight USING GIN(tag_ids);

-- Task table for user and agent tasks
CREATE TABLE task (
  task_id SERIAL PRIMARY KEY,

  -- Core fields
  title TEXT NOT NULL,
  description TEXT,

  -- Source and ownership
  source TEXT NOT NULL CHECK (source IN ('user', 'agent')),

  -- Status workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- not started
    'in_progress',  -- actively working on
    'completed',    -- done
    'archived'      -- hidden but preserved
  )),

  -- Priority (1=highest, 10=lowest)
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),

  -- Optional scheduling
  due_date DATE,
  reminder_at TIMESTAMPTZ,

  -- Related entities
  insight_id INTEGER REFERENCES insight(insight_id) ON DELETE SET NULL,
  doc_ids INTEGER[] DEFAULT '{}',
  url_ids INTEGER[] DEFAULT '{}',
  tag_ids INTEGER[] DEFAULT '{}',

  -- Flexible metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);

CREATE INDEX idx_task_status ON task(status);
CREATE INDEX idx_task_source ON task(source);
CREATE INDEX idx_task_priority ON task(priority, created_at DESC);
CREATE INDEX idx_task_due_date ON task(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_task_insight ON task(insight_id) WHERE insight_id IS NOT NULL;

-- Search log for pattern detection (repeated searches)
CREATE TABLE search_log (
  search_id SERIAL PRIMARY KEY,

  -- Query details
  query_text TEXT NOT NULL,
  query_embedding vector(1536),  -- for similarity matching
  search_mode TEXT NOT NULL CHECK (search_mode IN ('semantic', 'keyword', 'hybrid')),

  -- Filters applied
  time_range_start TIMESTAMPTZ,
  time_range_end TIMESTAMPTZ,
  domains TEXT[],

  -- Results
  results_count INTEGER NOT NULL DEFAULT 0,
  clicked_doc_ids INTEGER[] DEFAULT '{}',
  top_result_doc_id INTEGER,

  -- Context (which activity session triggered this search)
  session_id INTEGER REFERENCES activity_session(session_id) ON DELETE SET NULL,

  searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_search_log_time ON search_log(searched_at DESC);
CREATE INDEX idx_search_log_query ON search_log USING GIN(to_tsvector('english', query_text));
CREATE INDEX idx_search_log_embedding ON search_log
  USING hnsw (query_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Update trigger for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insight_updated_at
  BEFORE UPDATE ON insight
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER task_updated_at
  BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
