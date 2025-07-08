const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5, // Optimal pool size for free tier
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'school-management-app'
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