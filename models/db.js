const { Pool } = require('pg');
require('dotenv').config();

// Create a pool of connections using the DATABASE_URL from .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, // Handle SSL for production
});

module.exports = pool;
