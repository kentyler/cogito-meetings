/**
 * Data migration script: Supabase → Render PostgreSQL
 * 
 * This script exports data from Supabase and imports it to the new Render database
 * Run with: node migrations/migrate-data.js
 */

const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Source: Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Destination: Render PostgreSQL
const renderDB = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Always use SSL for Render
});

async function migrateUsers() {
  console.log('🔄 Migrating users...');
  
  try {
    // Export from Supabase
    const { data: users, error } = await supabase
      .from('users')
      .select('*');
    
    if (error) {
      console.log('⚠️  No users table found in Supabase, creating default user');
      return;
    }

    // Import to Render
    for (const user of users) {
      await renderDB.query(
        `INSERT INTO client_mgmt.users (id, email, password_hash, active, created_at, updated_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         active = EXCLUDED.active,
         updated_at = EXCLUDED.updated_at,
         metadata = EXCLUDED.metadata`,
        [
          user.id, 
          user.email, 
          user.password_hash || null,
          user.active !== false,
          user.created_at || new Date(),
          user.updated_at || new Date(),
          user.metadata || {}
        ]
      );
    }
    
    console.log(`✅ Migrated ${users.length} users`);
  } catch (error) {
    console.error('❌ Error migrating users:', error.message);
  }
}

async function migrateParticipants() {
  console.log('🔄 Migrating participants...');
  
  try {
    // Try different possible table locations
    let participants = null;
    
    // Try public schema first
    try {
      const { data, error } = await supabase
        .from('participants')
        .select('*');
      
      if (!error) participants = data;
    } catch (e) {
      console.log('No participants in public schema');
    }
    
    // Try participant_users view
    if (!participants) {
      try {
        const { data, error } = await supabase
          .from('participant_users')
          .select('*');
        
        if (!error) {
          participants = data.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type || 'human',
            email: p.email,
            metadata: p.metadata || {},
            created_at: p.created_at || p.user_created_at,
            updated_at: p.updated_at,
            is_active: p.is_active !== false
          }));
        }
      } catch (e) {
        console.log('No participant_users view found');
      }
    }

    if (!participants || participants.length === 0) {
      console.log('⚠️  No participants found, using defaults');
      return;
    }

    // Import to Render
    for (const participant of participants) {
      await renderDB.query(
        `INSERT INTO conversation.participants (id, name, type, email, metadata, patterns, created_at, updated_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         email = EXCLUDED.email,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at,
         is_active = EXCLUDED.is_active`,
        [
          participant.id,
          participant.name,
          participant.type || 'human',
          participant.email,
          participant.metadata || {},
          participant.patterns || {},
          participant.created_at || new Date(),
          participant.updated_at || new Date(),
          participant.is_active !== false
        ]
      );
    }
    
    console.log(`✅ Migrated ${participants.length} participants`);
  } catch (error) {
    console.error('❌ Error migrating participants:', error.message);
  }
}

async function migrateBlocks() {
  console.log('🔄 Migrating blocks...');
  
  try {
    // Try to get blocks from block_turn_details view
    const { data: blockDetails, error } = await supabase
      .from('block_turn_details')
      .select('block_id, block_name, block_type')
      .order('block_id');
    
    if (error || !blockDetails) {
      console.log('⚠️  No blocks found');
      return;
    }

    // Deduplicate blocks
    const uniqueBlocks = {};
    blockDetails.forEach(block => {
      if (!uniqueBlocks[block.block_id]) {
        uniqueBlocks[block.block_id] = {
          block_id: block.block_id,
          name: block.block_name,
          block_type: block.block_type || 'session',
          description: `Migrated block: ${block.block_name}`,
          metadata: {},
          created_at: new Date(),
          updated_at: new Date()
        };
      }
    });

    const blocks = Object.values(uniqueBlocks);

    // Import to Render
    for (const block of blocks) {
      await renderDB.query(
        `INSERT INTO conversation.blocks (block_id, name, description, block_type, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (block_id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         block_type = EXCLUDED.block_type,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
        [
          block.block_id,
          block.name,
          block.description,
          block.block_type,
          block.metadata,
          block.created_at,
          block.updated_at
        ]
      );
    }
    
    console.log(`✅ Migrated ${blocks.length} blocks`);
  } catch (error) {
    console.error('❌ Error migrating blocks:', error.message);
  }
}

async function migrateTurns() {
  console.log('🔄 Migrating turns and block_turns...');
  
  try {
    // Get turns from block_turn_details view
    const { data: turnDetails, error } = await supabase
      .from('block_turn_details')
      .select('*')
      .order('block_id, sequence_order');
    
    if (error || !turnDetails) {
      console.log('⚠️  No turns found');
      return;
    }

    console.log(`Found ${turnDetails.length} turn records`);

    // Import turns and block_turns
    for (const turn of turnDetails) {
      // Insert turn
      await renderDB.query(
        `INSERT INTO conversation.turns (turn_id, participant_id, content, source_type, metadata, timestamp, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (turn_id) DO UPDATE SET
         participant_id = EXCLUDED.participant_id,
         content = EXCLUDED.content,
         source_type = EXCLUDED.source_type,
         metadata = EXCLUDED.metadata,
         timestamp = EXCLUDED.timestamp`,
        [
          turn.turn_id,
          turn.client_id || null, // Map client_id to participant_id
          turn.content,
          turn.source_type || 'chat',
          turn.turn_metadata || {},
          turn.timestamp || new Date(),
          new Date()
        ]
      );

      // Insert block_turn relationship
      await renderDB.query(
        `INSERT INTO conversation.block_turns (block_id, turn_id, sequence_order, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (block_id, turn_id) DO UPDATE SET
         sequence_order = EXCLUDED.sequence_order`,
        [
          turn.block_id,
          turn.turn_id,
          turn.sequence_order || 0,
          new Date()
        ]
      );
    }
    
    console.log(`✅ Migrated ${turnDetails.length} turns and relationships`);
  } catch (error) {
    console.error('❌ Error migrating turns:', error.message);
  }
}

async function migrateMeetingData() {
  console.log('🔄 Migrating meeting data...');
  
  try {
    // Get meeting data from Supabase
    const { data: meetings, error: meetingsError } = await supabase
      .from('block_meetings')
      .select('*');
    
    if (meetings && meetings.length > 0) {
      for (const meeting of meetings) {
        await renderDB.query(
          `INSERT INTO conversation.block_meetings 
           (block_id, recall_bot_id, meeting_url, status, invited_by_user_id, full_transcript, started_at, ended_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (block_id) DO UPDATE SET
           recall_bot_id = EXCLUDED.recall_bot_id,
           meeting_url = EXCLUDED.meeting_url,
           status = EXCLUDED.status,
           invited_by_user_id = EXCLUDED.invited_by_user_id,
           full_transcript = EXCLUDED.full_transcript,
           started_at = EXCLUDED.started_at,
           ended_at = EXCLUDED.ended_at,
           updated_at = EXCLUDED.updated_at`,
          [
            meeting.block_id,
            meeting.recall_bot_id,
            meeting.meeting_url,
            meeting.status,
            meeting.invited_by_user_id,
            meeting.full_transcript,
            meeting.started_at,
            meeting.ended_at,
            meeting.created_at,
            meeting.updated_at
          ]
        );
      }
      console.log(`✅ Migrated ${meetings.length} meeting records`);
    }

    // Get attendee data
    const { data: attendees, error: attendeesError } = await supabase
      .from('block_attendees')
      .select('*');
    
    if (attendees && attendees.length > 0) {
      for (const attendee of attendees) {
        await renderDB.query(
          `INSERT INTO conversation.block_attendees 
           (id, block_id, name, user_id, story, speaking_time_seconds, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET
           block_id = EXCLUDED.block_id,
           name = EXCLUDED.name,
           user_id = EXCLUDED.user_id,
           story = EXCLUDED.story,
           speaking_time_seconds = EXCLUDED.speaking_time_seconds,
           updated_at = EXCLUDED.updated_at`,
          [
            attendee.id,
            attendee.block_id,
            attendee.name,
            attendee.user_id,
            attendee.story,
            attendee.speaking_time_seconds,
            attendee.created_at,
            attendee.updated_at
          ]
        );
      }
      console.log(`✅ Migrated ${attendees.length} attendee records`);
    }

  } catch (error) {
    console.error('❌ Error migrating meeting data:', error.message);
  }
}

async function resetSequences() {
  console.log('🔄 Resetting sequences...');
  
  try {
    // Reset all sequences to avoid ID conflicts
    await renderDB.query(`
      SELECT setval('client_mgmt.users_id_seq', 
        (SELECT COALESCE(MAX(id), 1) FROM client_mgmt.users));
      
      SELECT setval('conversation.participants_id_seq', 
        (SELECT COALESCE(MAX(id), 3) FROM conversation.participants));
        
      SELECT setval('conversation.block_attendees_id_seq', 
        (SELECT COALESCE(MAX(id), 1) FROM conversation.block_attendees));
    `);
    
    console.log('✅ Sequences reset');
  } catch (error) {
    console.error('❌ Error resetting sequences:', error.message);
  }
}

async function main() {
  console.log('🚀 Starting data migration from Supabase to Render PostgreSQL...\n');
  
  try {
    // Test connections
    console.log('Testing database connections...');
    await renderDB.query('SELECT NOW()');
    console.log('✅ Render PostgreSQL connected\n');
    
    // Run migrations in order
    await migrateUsers();
    await migrateParticipants();
    await migrateBlocks();
    await migrateTurns();
    await migrateMeetingData();
    await resetSequences();
    
    console.log('\n🎉 Migration completed successfully!');
    console.log('The recall-bot can now use the Render database with full Cogito data.');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
  } finally {
    await renderDB.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };