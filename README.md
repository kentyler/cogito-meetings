# Cogito Recall Bot

Meeting bot service for Cogito that uses Recall.ai to join meetings and provide real-time transcription and analysis.

## Features

- Joins Zoom, Google Meet, Teams meetings via Recall.ai
- Real-time transcription via WebSocket
- Stores meeting data in Cogito's Supabase database
- Pattern detection and organizational intelligence

## Setup

1. Clone and install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

3. Set up environment variables:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_KEY`: Service role key (for server-side access)
- `RECALL_API_KEY`: Your Recall.ai API token

## Local Development

```bash
npm run dev
```

## Deployment on Render

1. Connect your GitHub repo to Render
2. Set environment variables in Render dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `RECALL_API_KEY`
3. Deploy!

## API Endpoints

### POST /api/create-bot
Create a bot to join a meeting.

```json
{
  "meeting_url": "https://zoom.us/j/123456789",
  "client_id": 1
}
```

### GET /health
Health check endpoint.

## WebSocket

The service accepts WebSocket connections for real-time transcription at `wss://your-app.onrender.com/transcript`.

## Database Schema

Uses existing Cogito database tables:
- `meetings`: Stores meeting metadata
- `meeting_turns`: Stores transcribed speech
- `meeting_insights`: Stores detected patterns (future)