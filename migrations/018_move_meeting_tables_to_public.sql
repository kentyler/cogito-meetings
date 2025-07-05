-- Migration: Move meeting tables from conversation schema to public schema
-- This enables Supabase REST API access

-- First, create the tables in public schema
CREATE TABLE IF NOT EXISTS public.block_meetings (
  block_id uuid PRIMARY KEY REFERENCES conversation.blocks(block_id) ON DELETE CASCADE,
  recall_bot_id TEXT UNIQUE, -- Recall.ai bot identifier
  meeting_url TEXT NOT NULL,
  status TEXT DEFAULT 'joining', -- joining, in_progress, completed, failed
  invited_by_user_id BIGINT REFERENCES client_mgmt.users(id), -- Who created the bot
  full_transcript JSONB, -- Complete transcript from Recall.ai when meeting ends
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.block_attendees (
  id BIGSERIAL PRIMARY KEY,
  block_id uuid REFERENCES conversation.blocks(block_id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- Name as provided by Recall.ai
  user_id BIGINT REFERENCES client_mgmt.users(id), -- NULL until they create account
  story TEXT, -- Their evolving narrative
  story_embedding vector(1536), -- For semantic search
  speaking_time_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Copy any existing data from conversation schema (if it exists)
INSERT INTO public.block_meetings 
SELECT * FROM conversation.block_meetings 
ON CONFLICT (block_id) DO NOTHING;

INSERT INTO public.block_attendees (block_id, name, user_id, story, story_embedding, speaking_time_seconds, created_at, updated_at)
SELECT block_id, name, user_id, story, story_embedding, speaking_time_seconds, created_at, updated_at 
FROM conversation.block_attendees 
ON CONFLICT (id) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_public_block_meetings_recall_bot_id ON public.block_meetings(recall_bot_id);
CREATE INDEX IF NOT EXISTS idx_public_block_meetings_invited_by ON public.block_meetings(invited_by_user_id);
CREATE INDEX IF NOT EXISTS idx_public_block_meetings_status ON public.block_meetings(status);

CREATE INDEX IF NOT EXISTS idx_public_block_attendees_block_id ON public.block_attendees(block_id);
CREATE INDEX IF NOT EXISTS idx_public_block_attendees_name ON public.block_attendees(name);
CREATE INDEX IF NOT EXISTS idx_public_block_attendees_user_id ON public.block_attendees(user_id);
CREATE INDEX IF NOT EXISTS idx_public_block_attendees_story_embedding ON public.block_attendees 
USING ivfflat (story_embedding vector_cosine_ops) WITH (lists = 100);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_block_attendees_unique ON public.block_attendees(block_id, name);

-- Grant permissions
GRANT ALL ON public.block_meetings TO authenticated;
GRANT ALL ON public.block_attendees TO authenticated;
GRANT ALL ON public.block_attendees_id_seq TO authenticated;

-- Drop the conversation schema tables (optional - comment out if you want to keep them as backup)
-- DROP TABLE IF EXISTS conversation.block_attendees;
-- DROP TABLE IF EXISTS conversation.block_meetings;