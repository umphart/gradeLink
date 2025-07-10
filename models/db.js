// models/db.js
const { Pool } = require('pg');
const fs = require('fs');

// PostgreSQL pool config
const pool = new Pool({
  user: 'school_admin',
  host: 'dpg-d1mfbe2dbo4c73f8apig-a.oregon-postgres.render.com',
  database: 'school_management_aymr',
  password: 'gF3BgZ6FIZJ6A0dIUyhjtRA9cZ4o7VBe',
  port: 5432,
  ssl: {
    rejectUnauthorized: false
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Events
pool.on('connect', () => {
  console.log('🟢 Database connection established');
});

pool.on('error', (err) => {
  console.error('🔴 Database connection error:', err);
});

// Test connection
(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to Render PostgreSQL');
    const res = await client.query('SELECT NOW()');
    console.log('📅 Database time:', res.rows[0].now);
    client.release();
  } catch (err) {
    console.error('❌ Failed to connect to database:', err);
    process.exit(1);
  }
})();

module.exports = pool; 
