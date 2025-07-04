# Deployment Guide for Cogito Recall Bot

## Step 1: Push to GitHub
1. Go to https://github.com/kentyler/cogito-meetings
2. Upload these files manually or set up Git authentication
3. Make sure all files are committed:
   - server.js
   - package.json
   - package-lock.json
   - README.md
   - .gitignore
   - .env.example

## Step 2: Deploy on Render
1. Go to https://render.com/dashboard
2. Click "New" → "Web Service"
3. Connect GitHub and select `kentyler/cogito-meetings`
4. Configure:
   - **Name**: cogito-recall-bot
   - **Branch**: main
   - **Build Command**: npm install
   - **Start Command**: npm start
   - **Plan**: Starter ($7/month)

## Step 3: Set Environment Variables
In Render dashboard, add these environment variables:

```
SUPABASE_URL=https://hpdbaeurycyhqigiatco.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZGJhZXVyeWN5aHFpZ2lhdGNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDQ0Nzg1OCwiZXhwIjoyMDY2MDIzODU4fQ.3iXWyAYugbrkO5uIE0zfYXZJe4u7Y3nhqlZPl9fjRFM
RECALL_API_KEY=9cd175818f68965427cfd5788009dc889ea84b81
```

## Step 4: Create Database Tables
1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/hpdbaeurycyhqigiatco
2. Go to SQL Editor
3. Run this SQL:

```sql
-- Meeting-specific data linked 1:1 to blocks
CREATE TABLE IF NOT EXISTS conversation.block_meetings (
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

-- Attendees for each meeting block
CREATE TABLE IF NOT EXISTS conversation.block_attendees (
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_block_meetings_recall_bot_id ON conversation.block_meetings(recall_bot_id);
CREATE INDEX IF NOT EXISTS idx_block_meetings_invited_by ON conversation.block_meetings(invited_by_user_id);
CREATE INDEX IF NOT EXISTS idx_block_meetings_status ON conversation.block_meetings(status);

CREATE INDEX IF NOT EXISTS idx_block_attendees_block_id ON conversation.block_attendees(block_id);
CREATE INDEX IF NOT EXISTS idx_block_attendees_name ON conversation.block_attendees(name);
CREATE INDEX IF NOT EXISTS idx_block_attendees_user_id ON conversation.block_attendees(user_id);
CREATE INDEX IF NOT EXISTS idx_block_attendees_story_embedding ON conversation.block_attendees 
USING ivfflat (story_embedding vector_cosine_ops) WITH (lists = 100);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_block_attendees_unique ON conversation.block_attendees(block_id, name);

-- Grant permissions
GRANT ALL ON conversation.block_meetings TO authenticated;
GRANT ALL ON conversation.block_attendees TO authenticated;
GRANT ALL ON conversation.block_attendees_id_seq TO authenticated;
```

## Step 5: Test Deployment
Once deployed, test the health endpoint:
https://your-app-name.onrender.com/health

Should return: `{"status":"healthy","service":"cogito-recall-bot"}`

## Step 6: Get Your Render URL
Copy the URL from Render dashboard (will be something like `cogito-recall-bot-xyz.onrender.com`).

You'll need this URL to integrate with Cogito UI for creating meeting bots.