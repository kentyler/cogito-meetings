-- Full Cogito database schema migration to Render PostgreSQL
-- This recreates the complete database structure from Supabase

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- CREATE EXTENSION IF NOT EXISTS vector; -- May need Render support to enable

-- Create schemas
CREATE SCHEMA IF NOT EXISTS client_mgmt;
CREATE SCHEMA IF NOT EXISTS conversation;

-- Set search path
SET search_path = public, conversation, client_mgmt;

-- =============================================
-- CLIENT MANAGEMENT SCHEMA TABLES
-- =============================================

-- Users table (authentication and basic info)
CREATE TABLE client_mgmt.users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- =============================================
-- CONVERSATION SCHEMA TABLES  
-- =============================================

-- Participants table (people and AI entities in conversations)
CREATE TABLE conversation.participants (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'human', -- 'human', 'ai_personality', etc.
    email VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    patterns JSONB DEFAULT '{}', -- For pattern tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Blocks table (containers for conversation sessions/meetings)
CREATE TABLE conversation.blocks (
    block_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    block_type VARCHAR(50) DEFAULT 'session', -- 'session', 'meeting', etc.
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Turns table (individual messages/contributions)
CREATE TABLE conversation.turns (
    turn_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id BIGINT REFERENCES conversation.participants(id),
    content TEXT NOT NULL,
    source_type VARCHAR(50) DEFAULT 'chat',
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Block-turns junction table (links turns to blocks)
CREATE TABLE conversation.block_turns (
    block_id uuid REFERENCES conversation.blocks(block_id) ON DELETE CASCADE,
    turn_id uuid REFERENCES conversation.turns(turn_id) ON DELETE CASCADE,
    sequence_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (block_id, turn_id)
);

-- Meeting-specific data
CREATE TABLE conversation.block_meetings (
    block_id uuid PRIMARY KEY REFERENCES conversation.blocks(block_id) ON DELETE CASCADE,
    recall_bot_id TEXT UNIQUE,
    meeting_url TEXT NOT NULL,
    status TEXT DEFAULT 'joining',
    invited_by_user_id BIGINT REFERENCES client_mgmt.users(id),
    full_transcript JSONB,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meeting attendees
CREATE TABLE conversation.block_attendees (
    id BIGSERIAL PRIMARY KEY,
    block_id uuid REFERENCES conversation.blocks(block_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    user_id BIGINT REFERENCES client_mgmt.users(id),
    story TEXT,
    -- story_embedding vector(1536), -- Uncomment when vector extension available
    speaking_time_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================

-- Users indexes
CREATE INDEX idx_users_email ON client_mgmt.users(email);
CREATE INDEX idx_users_active ON client_mgmt.users(active);

-- Participants indexes  
CREATE INDEX idx_participants_name ON conversation.participants(name);
CREATE INDEX idx_participants_email ON conversation.participants(email);
CREATE INDEX idx_participants_type ON conversation.participants(type);
CREATE INDEX idx_participants_active ON conversation.participants(is_active);

-- Blocks indexes
CREATE INDEX idx_blocks_type ON conversation.blocks(block_type);
CREATE INDEX idx_blocks_created_at ON conversation.blocks(created_at);

-- Turns indexes
CREATE INDEX idx_turns_participant_id ON conversation.turns(participant_id);
CREATE INDEX idx_turns_timestamp ON conversation.turns(timestamp);
CREATE INDEX idx_turns_source_type ON conversation.turns(source_type);

-- Block turns indexes
CREATE INDEX idx_block_turns_block_id ON conversation.block_turns(block_id);
CREATE INDEX idx_block_turns_sequence ON conversation.block_turns(block_id, sequence_order);

-- Meeting indexes
CREATE INDEX idx_block_meetings_recall_bot_id ON conversation.block_meetings(recall_bot_id);
CREATE INDEX idx_block_meetings_status ON conversation.block_meetings(status);
CREATE INDEX idx_block_meetings_invited_by ON conversation.block_meetings(invited_by_user_id);

-- Attendee indexes
CREATE INDEX idx_block_attendees_block_id ON conversation.block_attendees(block_id);
CREATE INDEX idx_block_attendees_name ON conversation.block_attendees(name);
CREATE INDEX idx_block_attendees_user_id ON conversation.block_attendees(user_id);

-- Unique constraints
CREATE UNIQUE INDEX idx_block_attendees_unique ON conversation.block_attendees(block_id, name);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Find participant by name or email
CREATE OR REPLACE FUNCTION find_participant_id(identifier TEXT)
RETURNS BIGINT AS $$
DECLARE
    participant_id BIGINT;
BEGIN
    -- Try by name first
    SELECT id INTO participant_id 
    FROM conversation.participants 
    WHERE name ILIKE identifier AND is_active = true
    LIMIT 1;
    
    -- If not found, try by email
    IF participant_id IS NULL THEN
        SELECT id INTO participant_id 
        FROM conversation.participants 
        WHERE email ILIKE identifier AND is_active = true
        LIMIT 1;
    END IF;
    
    RETURN participant_id;
END;
$$ LANGUAGE plpgsql;

-- Get participant by name
CREATE OR REPLACE FUNCTION get_participant_id_by_name(participant_name TEXT)
RETURNS BIGINT AS $$
DECLARE
    participant_id BIGINT;
BEGIN
    SELECT id INTO participant_id 
    FROM conversation.participants 
    WHERE name ILIKE participant_name AND is_active = true
    LIMIT 1;
    
    RETURN participant_id;
END;
$$ LANGUAGE plpgsql;

-- Get participant by email
CREATE OR REPLACE FUNCTION get_participant_id_by_email(participant_email TEXT)
RETURNS BIGINT AS $$
DECLARE
    participant_id BIGINT;
BEGIN
    SELECT id INTO participant_id 
    FROM conversation.participants 
    WHERE email ILIKE participant_email AND is_active = true
    LIMIT 1;
    
    RETURN participant_id;
END;
$$ LANGUAGE plpgsql;

-- Update participant patterns
CREATE OR REPLACE FUNCTION update_participant_patterns(
    p_participant_id BIGINT,
    p_pattern_name TEXT,
    p_pattern_data JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
    rows_affected INTEGER;
BEGIN
    UPDATE conversation.participants 
    SET patterns = jsonb_set(
        COALESCE(patterns, '{}'),
        ARRAY[p_pattern_name],
        p_pattern_data,
        true
    ),
    updated_at = NOW()
    WHERE id = p_participant_id;
    
    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS FOR UPDATED_AT
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON client_mgmt.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_participants_updated_at BEFORE UPDATE ON conversation.participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_blocks_updated_at BEFORE UPDATE ON conversation.blocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_block_meetings_updated_at BEFORE UPDATE ON conversation.block_meetings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_block_attendees_updated_at BEFORE UPDATE ON conversation.block_attendees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- SEED DATA
-- =============================================

-- Insert default participants
INSERT INTO conversation.participants (id, name, type, email, metadata) VALUES
(1, 'System', 'system', 'system@cogito.local', '{"role": "system"}'),
(2, 'Cogito', 'ai_personality', 'cogito@cogito.local', '{"role": "ai_assistant"}'),
(3, 'Ken', 'human', 'ken@8thfold.com', '{"role": "user"}')
ON CONFLICT (id) DO NOTHING;

-- Reset sequence to avoid conflicts
SELECT setval('conversation.participants_id_seq', 
    (SELECT GREATEST(MAX(id), 3) FROM conversation.participants));

-- Insert default user
INSERT INTO client_mgmt.users (id, email, active, metadata) VALUES
(1, 'ken@8thfold.com', true, '{"role": "admin"}')
ON CONFLICT (id) DO NOTHING;

-- Reset user sequence
SELECT setval('client_mgmt.users_id_seq', 
    (SELECT GREATEST(MAX(id), 1) FROM client_mgmt.users));

-- =============================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================

COMMENT ON SCHEMA client_mgmt IS 'Client management - users, authentication, billing';
COMMENT ON SCHEMA conversation IS 'Conversation data - participants, blocks, turns, meetings';

COMMENT ON TABLE client_mgmt.users IS 'User accounts and authentication';
COMMENT ON TABLE conversation.participants IS 'People and AI entities in conversations';
COMMENT ON TABLE conversation.blocks IS 'Containers for conversation sessions and meetings';
COMMENT ON TABLE conversation.turns IS 'Individual messages and contributions';
COMMENT ON TABLE conversation.block_turns IS 'Links turns to blocks in sequence';
COMMENT ON TABLE conversation.block_meetings IS 'Meeting-specific data for Recall.ai integration';
COMMENT ON TABLE conversation.block_attendees IS 'Meeting participants and their stories';