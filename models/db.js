// models/db.js
const { Pool } = require('pg');
const fs = require('fs');

// Enhanced PostgreSQL pool config
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://school_admin:gF3BgZ6FIZJ6A0dIUyhjtRA9cZ4o7VBe@dpg-d1mfbe2dbo4c73f8apig-a.oregon-postgres.render.com:5432/school_management_aymr',
  ssl: {
    rejectUnauthorized: false // This is less secure but works for development
  },
    
  max: 10, // Increased pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000, // Further increased timeout
  allowExitOnIdle: true
});

// Improved connection handling
let retryCount = 0;
const MAX_RETRIES = 3;

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to PostgreSQL');
    const res = await client.query('SELECT NOW()');
    console.log('📅 Database time:', res.rows[0].now);
    client.release();
    retryCount = 0; // Reset on success
  } catch (err) {
    console.error('❌ Connection attempt failed:', err.message);
    
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`🔄 Retrying connection (attempt ${retryCount}/${MAX_RETRIES})...`);
      setTimeout(testConnection, 2000); // Wait 2 seconds before retrying
    } else {
      console.error('🔥 Maximum retries reached. Exiting...');
      process.exit(1);
    }
  }
}

// Initial connection test
testConnection();

// Event listeners
pool.on('connect', () => {
  console.log('🟢 New client connection established');
});

pool.on('error', (err) => {
  console.error('🔴 Unexpected error on idle client:', err.message);
  // Optionally attempt to reconnect here
});

module.exports = pool;