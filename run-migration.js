/**
 * Migration runner for Render PostgreSQL
 * Runs the schema migration and then the data migration
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runSchemaMigration() {
  console.log('🔄 Running schema migration...');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Read the schema migration file
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'migrations', '001_full_cogito_schema.sql'), 
      'utf8'
    );

    // Execute the schema migration
    await pool.query(schemaSQL);
    console.log('✅ Schema migration completed successfully');

    // Test that tables were created
    const result = await pool.query(`
      SELECT table_name, table_schema 
      FROM information_schema.tables 
      WHERE table_schema IN ('client_mgmt', 'conversation', 'public')
      ORDER BY table_schema, table_name
    `);

    console.log('\n📋 Created tables:');
    result.rows.forEach(row => {
      console.log(`   ${row.table_schema}.${row.table_name}`);
    });

    return true;

  } catch (error) {
    console.error('❌ Schema migration failed:', error.message);
    return false;
  } finally {
    await pool.end();
  }
}

async function runDataMigration() {
  console.log('\n🔄 Running data migration...');
  
  try {
    const { main: migrateData } = require('./migrations/migrate-data.js');
    await migrateData();
    return true;
  } catch (error) {
    console.error('❌ Data migration failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting full migration to Render PostgreSQL...\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.log('Make sure you have set the Render PostgreSQL connection string in your .env file');
    process.exit(1);
  }

  console.log(`📍 Target database: ${process.env.DATABASE_URL.split('@')[1]}`);

  try {
    // Step 1: Create schema
    const schemaSuccess = await runSchemaMigration();
    if (!schemaSuccess) {
      console.error('Schema migration failed, stopping here.');
      process.exit(1);
    }

    // Step 2: Migrate data
    const dataSuccess = await runDataMigration();
    if (!dataSuccess) {
      console.error('Data migration failed, but schema is ready.');
      process.exit(1);
    }

    console.log('\n🎉 Full migration completed successfully!');
    console.log('Your Render database now has the complete Cogito schema and data.');
    console.log('You can now deploy the updated recall-bot server.');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runSchemaMigration, runDataMigration };