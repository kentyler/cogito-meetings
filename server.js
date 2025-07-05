require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');
const fetch = require('node-fetch');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocketServer({ server });

// Initialize PostgreSQL connection
// For Render deployment, use DATABASE_URL from environment variables
// This should be set in Render dashboard as the full PostgreSQL connection string
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  acquireTimeoutMillis: 10000,
});

// Set search path for schema access
pool.on('connect', (client) => {
  client.query('SET search_path = public, conversation, client_mgmt');
});

// Test database connection on startup
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL connected successfully');
    client.release();
  })
  .catch(err => {
    console.error('❌ PostgreSQL connection failed:', err.message);
  });

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'cogito-recall-bot', version: '1.1' });
});

// WebSocket handler for real-time transcription
wss.on('connection', (ws, req) => {
  console.log('Recall.ai bot connected for real-time transcription');
  
  ws.on('message', async (data) => {
    try {
      const transcript = JSON.parse(data.toString());
      console.log('Received transcript:', transcript);
      
      // Find the meeting by recall_bot_id
      const meetingResult = await pool.query(
        'SELECT block_id FROM block_meetings WHERE recall_bot_id = $1',
        [transcript.bot_id]
      );
      const meeting = meetingResult.rows[0];
      
      if (!meeting) {
        console.error('No meeting found for bot:', transcript.bot_id);
        return;
      }
      
      // Get or create attendee for this speaker
      const attendee = await getOrCreateAttendee(meeting.block_id, transcript.speaker);
      
      // Create a turn for this transcript
      const turnResult = await pool.query(
        `INSERT INTO turns (participant_id, content, source_type, metadata) 
         VALUES ($1, $2, $3, $4) RETURNING turn_id`,
        [
          attendee.id,
          transcript.text,
          'recall_bot',
          { 
            timestamp: transcript.timestamp || new Date().toISOString(),
            bot_id: transcript.bot_id 
          }
        ]
      );
      const turn = turnResult.rows[0];
      
      // Get next sequence order for this block
      const sequenceResult = await pool.query(
        'SELECT COALESCE(MAX(sequence_order), 0) + 1 as next_order FROM block_turns WHERE block_id = $1',
        [meeting.block_id]
      );
      
      // Link turn to the meeting block
      await pool.query(
        'INSERT INTO block_turns (block_id, turn_id, sequence_order) VALUES ($1, $2, $3)',
        [meeting.block_id, turn.turn_id, sequenceResult.rows[0].next_order]
      );
      
      // TODO: Add pattern analysis here
      
    } catch (error) {
      console.error('Error processing transcript:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Recall.ai bot disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Helper function to get or create attendee
async function getOrCreateAttendee(blockId, speakerName) {
  // Check if attendee already exists for this meeting
  const attendeeResult = await pool.query(
    'SELECT * FROM block_attendees WHERE block_id = $1 AND name = $2',
    [blockId, speakerName]
  );
  
  if (attendeeResult.rows.length > 0) {
    return attendeeResult.rows[0];
  }
  
  // Create new attendee
  const newAttendeeResult = await pool.query(
    `INSERT INTO block_attendees (block_id, name, story) 
     VALUES ($1, $2, $3) RETURNING *`,
    [blockId, speakerName, `${speakerName} joined the meeting.`]
  );
  
  return newAttendeeResult.rows[0];
}

// API endpoint to create a meeting bot
app.post('/api/create-bot', async (req, res) => {
  try {
    const { meeting_url, client_id, meeting_name } = req.body;
    
    if (!meeting_url) {
      return res.status(400).json({ error: 'meeting_url is required' });
    }
    
    console.log('Creating bot for meeting:', meeting_url);
    
    // Get the external URL for WebSocket connection
    const websocketUrl = process.env.RENDER_EXTERNAL_URL 
      ? `wss://${process.env.RENDER_EXTERNAL_URL}/transcript`
      : `ws://localhost:${process.env.PORT || 8080}/transcript`;
    
    // Create bot with Recall.ai
    const recallResponse = await fetch('https://us-west-2.recall.ai/api/v1/bot/', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.RECALL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        meeting_url: meeting_url,
        bot_name: 'Cogito',
        recording_config: {
          transcript: {
            provider: {
              meeting_captions: {}
            }
          }
        },
        webhook_url: `https://${process.env.RENDER_EXTERNAL_URL}/webhook`
      })
    });
    
    if (!recallResponse.ok) {
      const error = await recallResponse.text();
      console.error('Recall.ai error:', error);
      return res.status(recallResponse.status).json({ 
        error: 'Failed to create bot', 
        details: error 
      });
    }
    
    const botData = await recallResponse.json();
    console.log('Bot created:', botData);
    
    // Create a block for this meeting
    console.log('Creating block for meeting:', meeting_name);
    const blockResult = await pool.query(
      `INSERT INTO blocks (name, description, block_type, metadata) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        meeting_name || `Meeting ${new Date().toISOString()}`,
        `Meeting from ${meeting_url}`,
        'meeting',
        { created_by: 'recall_bot' }
      ]
    );
    const block = blockResult.rows[0];
    console.log('Block created:', block.block_id);
    
    // Create meeting-specific data
    const meetingResult = await pool.query(
      `INSERT INTO block_meetings (block_id, recall_bot_id, meeting_url, invited_by_user_id, status) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [block.block_id, botData.id, meeting_url, client_id, 'joining']
    );
    const meeting = meetingResult.rows[0];
    
    res.json({
      bot: botData,
      meeting_block: block,
      meeting: meeting
    });
    
  } catch (error) {
    console.error('Error creating bot:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Webhook endpoint for bot status updates
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    console.log('Webhook received:', event);
    
    // Update meeting status
    if (event.bot_id) {
      const updateData = { 
        status: event.status,
        updated_at: new Date().toISOString()
      };
      
      if (event.status === 'completed') {
        updateData.ended_at = new Date().toISOString();
        
        // Fetch complete transcript from Recall.ai
        try {
          const transcriptResponse = await fetch(`https://us-west-2.recall.ai/api/v1/bot/${event.bot_id}/transcript/`, {
            headers: {
              'Authorization': `Token ${process.env.RECALL_API_KEY}`
            }
          });
          
          if (transcriptResponse.ok) {
            const fullTranscript = await transcriptResponse.json();
            updateData.full_transcript = fullTranscript;
            console.log('Stored complete transcript for bot:', event.bot_id);
          } else {
            console.error('Failed to fetch transcript:', transcriptResponse.status);
          }
        } catch (error) {
          console.error('Error fetching transcript:', error);
        }
      }
      
      const updateFields = Object.keys(updateData).map((key, i) => `${key} = $${i + 2}`).join(', ');
      const updateValues = [event.bot_id, ...Object.values(updateData)];
      
      await pool.query(
        `UPDATE block_meetings SET ${updateFields} WHERE recall_bot_id = $1`,
        updateValues
      );
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Cogito Recall Bot server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});