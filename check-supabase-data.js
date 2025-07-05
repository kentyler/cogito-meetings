/**
 * Quick script to check what data exists in Supabase before migration
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkData() {
  console.log('Checking Supabase data...\n');

  // Check various tables
  const tables = [
    { name: 'users', schema: 'public' },
    { name: 'participants', schema: 'public' },
    { name: 'participant_users', schema: 'public' },
    { name: 'blocks', schema: 'public' },
    { name: 'block_turn_details', schema: 'public' },
    { name: 'block_meetings', schema: 'public' },
    { name: 'block_attendees', schema: 'public' },
    { name: 'locations', schema: 'public' }
  ];

  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table.name)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ ${table.name}: Not found or error`);
      } else {
        console.log(`✓ ${table.name}: ${count} records`);
      }
    } catch (e) {
      console.log(`❌ ${table.name}: Error accessing`);
    }
  }
}

checkData().catch(console.error);