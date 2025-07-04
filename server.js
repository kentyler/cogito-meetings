require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocketServer({ server });

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
      const { data: meeting } = await supabase
        .schema('meetings')
        .from('block_meetings')
        .select('block_id')
        .eq('recall_bot_id', transcript.bot_id)
        .single();
      
      if (!meeting) {
        console.error('No meeting found for bot:', transcript.bot_id);
        return;
      }
      
      // Get or create attendee for this speaker
      const attendee = await getOrCreateAttendee(meeting.block_id, transcript.speaker);
      
      // Create a turn for this transcript
      const { data: turn, error: turnError } = await supabase
        .from('turns')
        .insert({
          participant_id: attendee.id, // Use attendee ID as participant
          turn_text: transcript.text,
          source_type: 'recall_bot',
          turn_timestamp: transcript.timestamp || new Date().toISOString(),
          client_id: 1 // TODO: Get from meeting context
        })
        .select()
        .single();
      
      if (turnError) {
        console.error('Error creating turn:', turnError);
        return;
      }
      
      // Link turn to the meeting block
      await supabase
        .from('block_turns')
        .insert({
          block_id: meeting.block_id,
          turn_id: turn.turn_id,
          sequence_order: transcript.sequence || 0
        });
      
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
  const { data: attendee } = await supabase
    .schema('meetings')
    .from('block_attendees')
    .select('*')
    .eq('block_id', blockId)
    .eq('name', speakerName)
    .single();
  
  if (attendee) return attendee;
  
  // Create new attendee
  const { data: newAttendee } = await supabase
    .schema('meetings')
    .from('block_attendees')
    .insert({
      block_id: blockId,
      name: speakerName,
      story: `${speakerName} joined the meeting.`
    })
    .select()
    .single();
  
  return newAttendee;
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
        real_time_media: {
          websocket_transcription_url: websocketUrl
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
    const { data: block, error: blockError } = await supabase
      .from('blocks')
      .insert({
        name: meeting_name || `Meeting ${new Date().toISOString()}`,
        description: `Meeting from ${meeting_url}`,
        block_type: 'meeting',
        created_by: 'recall_bot'
      })
      .select()
      .single();
    
    if (blockError) {
      console.error('Block creation error:', blockError);
      return res.status(500).json({ error: 'Failed to create meeting block' });
    }
    
    // Create meeting-specific data
    const { data: meeting, error: meetingError } = await supabase
      .schema('meetings')
      .from('block_meetings')
      .insert({
        block_id: block.block_id,
        recall_bot_id: botData.id,
        meeting_url: meeting_url,
        invited_by_user_id: client_id, // TODO: Use actual user ID
        status: 'joining'
      })
      .select()
      .single();
    
    if (meetingError) {
      console.error('Meeting creation error:', meetingError);
      // Clean up block
      await supabase.from('blocks').delete().eq('block_id', block.block_id);
      return res.status(500).json({ error: 'Failed to create meeting record' });
    }
    
    res.json({
      bot: botData,
      meeting_block: block,
      meeting: meeting
    });
    
  } catch (error) {
    console.error('Error creating bot:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      
      await supabase
        .schema('meetings')
        .from('block_meetings')
        .update(updateData)
        .eq('recall_bot_id', event.bot_id);
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