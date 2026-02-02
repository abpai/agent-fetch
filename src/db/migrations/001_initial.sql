-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Canonical URL identity
CREATE TABLE url (
  url_id SERIAL PRIMARY KEY,
  url_norm TEXT UNIQUE NOT NULL,
  domain TEXT NOT NULL,
  path TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_url_domain ON url(domain);

-- Visit events (browsing history)
CREATE TABLE visit (
  visit_id SERIAL PRIMARY KEY,
  url_id INTEGER NOT NULL REFERENCES url(url_id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ NOT NULL,
  referrer_url_id INTEGER REFERENCES url(url_id)
);
CREATE INDEX idx_visit_url ON visit(url_id);
CREATE INDEX idx_visit_time ON visit(visited_at);

-- Crawled document (content at capture time)
CREATE TABLE document (
  doc_id SERIAL PRIMARY KEY,
  url_id INTEGER NOT NULL REFERENCES url(url_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  title TEXT,
  author TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending',
  lang TEXT,
  text_length INTEGER,
  html_key TEXT,
  markdown_key TEXT,
  search_vector tsvector,
  UNIQUE(url_id)
);
CREATE INDEX idx_doc_hash ON document(content_hash);
CREATE INDEX idx_doc_status ON document(status);
CREATE INDEX idx_doc_fts ON document USING GIN(search_vector);

-- Retrieval chunks (~500 tokens each)
CREATE TABLE chunk (
  chunk_id SERIAL PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES document(doc_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_type TEXT,
  heading TEXT,
  text TEXT NOT NULL,
  token_count INTEGER,
  char_start INTEGER,
  char_end INTEGER,
  embedding vector(1536),
  UNIQUE(doc_id, chunk_index)
);
CREATE INDEX idx_chunk_doc ON chunk(doc_id);

-- HNSW index for fast vector search
CREATE INDEX idx_chunk_embedding ON chunk
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Topic tags
CREATE TABLE tag (
  tag_id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE doc_tag (
  doc_id INTEGER REFERENCES document(doc_id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tag(tag_id) ON DELETE CASCADE,
  score REAL,
  source TEXT,
  PRIMARY KEY (doc_id, tag_id)
);

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
