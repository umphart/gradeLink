// models/db.js
const { Pool } = require('pg');
const fs = require('fs');

// Updated PostgreSQL pool config with your new credentials
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://school_admin:aProndWWyDXh45O6NeBqRaPFJPuhQvZA@dpg-d1s2s5idbo4c73bu9qkg-a.oregon-postgres.render.com:5432/school_management_aymr_ajcr',
  ssl: {
    rejectUnauthorized: false // Still needed for Render's free tier
  },
  max: 5, // Reduced from 10 to be more suitable for free tier
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  allowExitOnIdle: true
});

// Improved connection handling (keep your existing implementation)
let retryCount = 0;
const MAX_RETRIES = 3;

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to PostgreSQL');
    const res = await client.query('SELECT NOW()');
    console.log('📅 Database time:', res.rows[0].now);
    client.release();
    retryCount = 0;
  } catch (err) {
    console.error('❌ Connection attempt failed:', err.message);
    
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`🔄 Retrying connection (attempt ${retryCount}/${MAX_RETRIES})...`);
      setTimeout(testConnection, 2000);
    } else {
      console.error('🔥 Maximum retries reached. Exiting...');
      process.exit(1);
    }
  }
}

// Initial connection test
testConnection();

// Event listeners (keep your existing implementation)
pool.on('connect', () => {
  console.log('🟢 New client connection established');
});

pool.on('error', (err) => {
  console.error('🔴 Unexpected error on idle client:', err.message);
});

module.exports = pool;