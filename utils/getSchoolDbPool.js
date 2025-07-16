const { Pool } = require('pg');
require('dotenv').config(); // Load environment variables

function getSchoolDbPool(schoolDbName) {
  // Validate database name to prevent SQL injection
  if (!/^[a-zA-Z0-9_]+$/.test(schoolDbName)) {
    throw new Error('Invalid database name format');
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL || 
      `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${schoolDbName}`,
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV === 'production' // Only true in production
    },
    max: 5, // Conservative pool size for free tier
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
}

module.exports = getSchoolDbPool;