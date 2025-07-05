-- Additional schemas for Cogito database
-- Run this AFTER 001_full_cogito_schema.sql

-- Create additional schemas
CREATE SCHEMA IF NOT EXISTS files;
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS kanban;
CREATE SCHEMA IF NOT EXISTS meetings;
CREATE SCHEMA IF NOT EXISTS auth;

-- =============================================
-- FILES SCHEMA (from migration 011)
-- =============================================

CREATE TABLE files.uploads (
    id BIGSERIAL PRIMARY KEY,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) UNIQUE NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100),
    upload_path TEXT NOT NULL,
    uploaded_by BIGINT REFERENCES client_mgmt.users(id),
    upload_timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE files.file_references (
    id BIGSERIAL PRIMARY KEY,
    file_id BIGINT REFERENCES files.uploads(id) ON DELETE CASCADE,
    reference_type VARCHAR(50) NOT NULL,
    reference_id TEXT NOT NULL,
    reference_context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Files indexes
CREATE INDEX idx_files_uploads_filename ON files.uploads(original_filename);
CREATE INDEX idx_files_uploads_mime_type ON files.uploads(mime_type);
CREATE INDEX idx_files_uploads_uploaded_by ON files.uploads(uploaded_by);
CREATE INDEX idx_files_uploads_deleted ON files.uploads(is_deleted);
CREATE INDEX idx_files_references_file_id ON files.file_references(file_id);
CREATE INDEX idx_files_references_type_id ON files.file_references(reference_type, reference_id);

-- =============================================
-- EVENTS SCHEMA (from migration 010)
-- =============================================

CREATE TABLE events.event_types (
    id SERIAL PRIMARY KEY,
    event_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    schema_version VARCHAR(20) DEFAULT '1.0',
    required_fields JSONB DEFAULT '[]',
    optional_fields JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events.events (
    id BIGSERIAL PRIMARY KEY,
    event_type_id INTEGER REFERENCES events.event_types(id),
    participant_id BIGINT REFERENCES conversation.participants(id),
    session_id TEXT,
    event_data JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events.event_aggregations (
    id BIGSERIAL PRIMARY KEY,
    aggregation_type VARCHAR(50) NOT NULL,
    time_window VARCHAR(20) NOT NULL,
    participant_id BIGINT REFERENCES conversation.participants(id),
    metrics JSONB NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events indexes
CREATE INDEX idx_events_type_id ON events.events(event_type_id);
CREATE INDEX idx_events_participant_id ON events.events(participant_id);
CREATE INDEX idx_events_session_id ON events.events(session_id);
CREATE INDEX idx_events_created_at ON events.events(created_at);
CREATE INDEX idx_event_aggregations_type ON events.event_aggregations(aggregation_type);
CREATE INDEX idx_event_aggregations_participant ON events.event_aggregations(participant_id);
CREATE INDEX idx_event_aggregations_period ON events.event_aggregations(period_start, period_end);

-- =============================================
-- KANBAN SCHEMA
-- =============================================

CREATE TABLE kanban.boards (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id BIGINT REFERENCES client_mgmt.users(id),
    is_public BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE kanban.columns (
    id BIGSERIAL PRIMARY KEY,
    board_id BIGINT REFERENCES kanban.boards(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    position INTEGER NOT NULL,
    color VARCHAR(7),
    wip_limit INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE kanban.cards (
    id BIGSERIAL PRIMARY KEY,
    column_id BIGINT REFERENCES kanban.columns(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to BIGINT REFERENCES client_mgmt.users(id),
    position INTEGER NOT NULL,
    priority VARCHAR(20),
    due_date DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kanban indexes
CREATE INDEX idx_kanban_boards_owner ON kanban.boards(owner_id);
CREATE INDEX idx_kanban_columns_board ON kanban.columns(board_id);
CREATE INDEX idx_kanban_columns_position ON kanban.columns(board_id, position);
CREATE INDEX idx_kanban_cards_column ON kanban.cards(column_id);
CREATE INDEX idx_kanban_cards_assigned ON kanban.cards(assigned_to);
CREATE INDEX idx_kanban_cards_position ON kanban.cards(column_id, position);

-- =============================================
-- MEETINGS SCHEMA (separate from conversation.block_meetings)
-- =============================================

CREATE TABLE meetings.scheduled_meetings (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ NOT NULL,
    meeting_url TEXT,
    organizer_id BIGINT REFERENCES client_mgmt.users(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE meetings.meeting_participants (
    id BIGSERIAL PRIMARY KEY,
    meeting_id BIGINT REFERENCES meetings.scheduled_meetings(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES client_mgmt.users(id),
    participant_email VARCHAR(255),
    participant_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'attendee',
    rsvp_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meetings indexes
CREATE INDEX idx_scheduled_meetings_organizer ON meetings.scheduled_meetings(organizer_id);
CREATE INDEX idx_scheduled_meetings_time ON meetings.scheduled_meetings(scheduled_start, scheduled_end);
CREATE INDEX idx_meeting_participants_meeting ON meetings.meeting_participants(meeting_id);
CREATE INDEX idx_meeting_participants_user ON meetings.meeting_participants(user_id);

-- =============================================
-- AUTH SCHEMA
-- =============================================

CREATE TABLE auth.sessions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT REFERENCES client_mgmt.users(id),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

CREATE TABLE auth.refresh_tokens (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT REFERENCES client_mgmt.users(id),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

-- Auth indexes
CREATE INDEX idx_auth_sessions_user ON auth.sessions(user_id);
CREATE INDEX idx_auth_sessions_token ON auth.sessions(token_hash);
CREATE INDEX idx_auth_sessions_expires ON auth.sessions(expires_at);
CREATE INDEX idx_auth_refresh_tokens_user ON auth.refresh_tokens(user_id);
CREATE INDEX idx_auth_refresh_tokens_token ON auth.refresh_tokens(token_hash);

-- =============================================
-- LOCATIONS TABLE (from migration 003)
-- =============================================

CREATE TABLE IF NOT EXISTS public.locations (
    id SERIAL PRIMARY KEY,
    file_path TEXT NOT NULL,
    description TEXT NOT NULL,
    project VARCHAR(100),
    category VARCHAR(50),
    tags TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_project ON public.locations(project);
CREATE INDEX IF NOT EXISTS idx_locations_category ON public.locations(category);

-- =============================================
-- GRANT PERMISSIONS
-- =============================================

-- Note: Render PostgreSQL uses standard PostgreSQL roles
-- The application will connect with the database owner role
-- No additional grants needed for standard setup

-- =============================================
-- ADD TRIGGERS FOR UPDATED_AT
-- =============================================

CREATE TRIGGER update_kanban_boards_updated_at BEFORE UPDATE ON kanban.boards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kanban_cards_updated_at BEFORE UPDATE ON kanban.cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meetings_scheduled_updated_at BEFORE UPDATE ON meetings.scheduled_meetings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON public.locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();