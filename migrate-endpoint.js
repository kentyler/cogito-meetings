/**
 * Simple HTTP endpoint to run migration from within Render
 * Add this temporarily to server.js to run migration
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Add this endpoint to your server.js temporarily
function addMigrationEndpoint(app) {
  app.get('/migrate', async (req, res) => {
    try {
      console.log('🔄 Starting migration...');
      
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });

      // Read schema file
      const schemaSQL = fs.readFileSync(
        path.join(__dirname, 'migrations', '001_full_cogito_schema.sql'), 
        'utf8'
      );

      // Execute schema migration
      await pool.query(schemaSQL);
      console.log('✅ Schema migration completed');

      // Test tables were created
      const result = await pool.query(`
        SELECT table_name, table_schema 
        FROM information_schema.tables 
        WHERE table_schema IN ('client_mgmt', 'conversation', 'public')
        ORDER BY table_schema, table_name
      `);

      await pool.end();

      res.json({
        success: true,
        message: 'Schema migration completed successfully',
        tables: result.rows
      });

    } catch (error) {
      console.error('Migration error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
}

module.exports = { addMigrationEndpoint };