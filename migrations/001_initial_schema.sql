-- Initial schema for cogito-meetings database
-- Creates all necessary tables for meeting bot functionality

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable vector extension for embeddings (if available)
-- This may need to be enabled by Render support
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Create basic blocks table for meeting organization
CREATE TABLE blocks (
  block_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  block_type VARCHAR(50) DEFAULT 'meeting',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create meeting-specific data table
CREATE TABLE block_meetings (
  block_id uuid PRIMARY KEY REFERENCES blocks(block_id) ON DELETE CASCADE,
  recall_bot_id TEXT UNIQUE NOT NULL, -- Recall.ai bot identifier
  meeting_url TEXT NOT NULL,
  status TEXT DEFAULT 'joining', -- joining, in_progress, completed, failed
  invited_by_user_id BIGINT, -- Reference to user who created the bot
  full_transcript JSONB, -- Complete transcript from Recall.ai when meeting ends
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create attendees table for meeting participants
CREATE TABLE block_attendees (
  id BIGSERIAL PRIMARY KEY,
  block_id uuid REFERENCES blocks(block_id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- Name as provided by Recall.ai
  user_id BIGINT, -- Reference to user account (if they have one)
  story TEXT, -- Their evolving narrative
  -- story_embedding vector(1536), -- For semantic search (commented out until vector extension available)
  speaking_time_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create turns table for conversation content
CREATE TABLE turns (
  turn_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id BIGINT, -- References attendee ID
  content TEXT NOT NULL,
  source_type VARCHAR(50) DEFAULT 'recall_bot',
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create block_turns junction table
CREATE TABLE block_turns (
  block_id uuid REFERENCES blocks(block_id) ON DELETE CASCADE,
  turn_id uuid REFERENCES turns(turn_id) ON DELETE CASCADE,
  sequence_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (block_id, turn_id)
);

-- Create indexes for performance
CREATE INDEX idx_block_meetings_recall_bot_id ON block_meetings(recall_bot_id);
CREATE INDEX idx_block_meetings_status ON block_meetings(status);
CREATE INDEX idx_block_meetings_created_at ON block_meetings(created_at);

CREATE INDEX idx_block_attendees_block_id ON block_attendees(block_id);
CREATE INDEX idx_block_attendees_name ON block_attendees(name);
CREATE INDEX idx_block_attendees_user_id ON block_attendees(user_id);

CREATE INDEX idx_turns_participant_id ON turns(participant_id);
CREATE INDEX idx_turns_timestamp ON turns(timestamp);
CREATE INDEX idx_turns_source_type ON turns(source_type);

CREATE INDEX idx_block_turns_block_id ON block_turns(block_id);
CREATE INDEX idx_block_turns_sequence ON block_turns(block_id, sequence_order);

-- Unique constraints
CREATE UNIQUE INDEX idx_block_attendees_unique ON block_attendees(block_id, name);

-- Add comments for documentation
COMMENT ON TABLE blocks IS 'Container for meeting sessions and conversations';
COMMENT ON TABLE block_meetings IS 'Meeting-specific data linked to Recall.ai bots';
COMMENT ON TABLE block_attendees IS 'Participants in meetings with their evolving stories';
COMMENT ON TABLE turns IS 'Individual conversation turns/messages';
COMMENT ON TABLE block_turns IS 'Links turns to their containing blocks in sequence';

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at columns
CREATE TRIGGER update_blocks_updated_at BEFORE UPDATE ON blocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_block_meetings_updated_at BEFORE UPDATE ON block_meetings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_block_attendees_updated_at BEFORE UPDATE ON block_attendees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();