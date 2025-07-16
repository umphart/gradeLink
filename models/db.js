// models/db.js
const { Pool } = require('pg');
const fs = require('fs');

// Enhanced PostgreSQL pool config
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://school_management_db_xo40_user:nN35caUc34krtF9cO0rYomNscsDGktps@dpg-d1s0es95pdvs739p23v0-a.oregon-postgres.render.com/school_management_db_xo40',
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
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