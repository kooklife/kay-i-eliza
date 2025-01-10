-- Enable the required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create the enhanced conversations table
CREATE TABLE enhanced_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    messages JSONB NOT NULL,
    metadata JSONB NOT NULL,
    embedding vector(1536),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

-- Create indexes for efficient searching
CREATE INDEX enhanced_conversations_embedding_idx ON enhanced_conversations USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX enhanced_conversations_metadata_type_idx ON enhanced_conversations USING gin ((metadata->'type'));
CREATE INDEX enhanced_conversations_metadata_tags_idx ON enhanced_conversations USING gin ((metadata->'tags'));
CREATE INDEX enhanced_conversations_created_at_idx ON enhanced_conversations(created_at);

-- Create a function to update search vector
CREATE OR REPLACE FUNCTION update_enhanced_conversation_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.metadata->>'projectContext', '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add search vector column
ALTER TABLE enhanced_conversations ADD COLUMN search_vector tsvector;
CREATE INDEX enhanced_conversations_search_idx ON enhanced_conversations USING gin(search_vector);

-- Create trigger for search vector updates
CREATE TRIGGER enhanced_conversations_search_vector_update
    BEFORE INSERT OR UPDATE
    ON enhanced_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_enhanced_conversation_search_vector();

-- Create a function to search conversations by similarity
CREATE OR REPLACE FUNCTION search_conversations(
    query_text TEXT,
    match_threshold FLOAT DEFAULT 0.8,
    match_count INT DEFAULT 10
) RETURNS TABLE (
    id TEXT,
    title TEXT,
    messages JSONB,
    metadata JSONB,
    similarity FLOAT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        ec.id,
        ec.title,
        ec.messages,
        ec.metadata,
        ts_rank_cd(ec.search_vector, query_vector) AS similarity
    FROM
        enhanced_conversations ec,
        to_tsquery('english', query_text) query_vector
    WHERE
        ec.search_vector @@ query_vector
    ORDER BY
        similarity DESC
    LIMIT match_count;
END;
$$;