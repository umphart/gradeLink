const { Pool } = require('pg');

// In your main db.js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false 
  } : false
});

// Enhanced connection logging
pool.on('connect', (client) => {
  console.log(`🟢 New DB connection established (Total: ${pool.totalCount})`);
});

pool.on('error', (err) => {
  console.error('🔴 Database error:', err);
});

module.exports = {
  query: (text, params) => {
    console.log('Executing query:', text);
    return pool.query(text, params);
  },
  pool
};