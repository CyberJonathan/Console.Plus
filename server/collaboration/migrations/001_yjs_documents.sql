CREATE TABLE IF NOT EXISTS yjs_documents (
  document_name TEXT PRIMARY KEY CHECK (char_length(document_name) <= 64),
  state BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
