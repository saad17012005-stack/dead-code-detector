CREATE TABLE IF NOT EXISTS scan_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository VARCHAR(255) NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidates (
    id VARCHAR(255) PRIMARY KEY,
    scan_run_id UUID REFERENCES scan_runs(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL, -- 'near_duplicate' | 'rbu'
    confidence VARCHAR(50) NOT NULL,   -- 'high' | 'provenance_unclear'
    suggested_action VARCHAR(50),      -- 'review_for_merge' | 'review_for_removal'
    llm_verification JSONB,            -- { verdict, rationale }
    definition VARCHAR(10) NOT NULL    -- '1', '2', or '4'
);

CREATE TABLE IF NOT EXISTS candidate_functions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id VARCHAR(255) REFERENCES candidates(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file VARCHAR(1024) NOT NULL,
    commit_hash VARCHAR(255),
    role VARCHAR(50) -- e.g., 'primary', 'duplicate'
);

CREATE TABLE IF NOT EXISTS candidate_evidence (
    candidate_id VARCHAR(255) PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
    semantic_similarity DOUBLE PRECISION,
    lexical_similarity DOUBLE PRECISION,
    commit_time_delta_minutes INTEGER,
    reachable BOOLEAN,
    production_call_sites INTEGER,
    ai_authorship_markers JSONB -- Array of strings
);

CREATE TABLE IF NOT EXISTS finding_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id VARCHAR(255) REFERENCES candidates(id) ON DELETE CASCADE,
    user_id VARCHAR(255),
    action VARCHAR(50) NOT NULL, -- 'accepted' | 'dismissed' | 'snoozed'
    acted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS baseline_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_run_id UUID REFERENCES scan_runs(id) ON DELETE CASCADE,
    tool VARCHAR(50) NOT NULL,
    raw_output JSONB
);

-- Note: function_embeddings table was assumed to be created during Phase 2 by similarity worker.
