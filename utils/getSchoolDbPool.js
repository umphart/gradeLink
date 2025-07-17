require('dotenv').config();
const { Pool } = require('pg');

// Cache for school database pools
const schoolPools = new Map();

function getSchoolDbPool(schoolDbName) {
  // Return existing pool if available
  if (schoolPools.has(schoolDbName)) {
    return schoolPools.get(schoolDbName);
  }

  // Validate database name to prevent SQL injection
  if (!/^school_[a-z0-9_]+$/.test(schoolDbName)) {
    throw new Error('Invalid school database name format');
  }

  // Create new pool configuration
  const poolConfig = {
    user: process.env.PG_USER || 'school_admin',
    host: process.env.PG_HOST || 'dpg-d1s2s5idbo4c73bu9qkg-a.oregon-postgres.render.com',
    database: schoolDbName,
    password: process.env.PG_PASSWORD || 'aProndWWyDXh45O6NeBqRaPFJPuhQvZA',
    port: process.env.PG_PORT || 5432,
    ssl: {
      rejectUnauthorized: false
    },
    max: 5, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 5000, // Return error after 5 seconds if connection not established
  };

  // Create new pool
  const pool = new Pool(poolConfig);

  // Error handling for the pool
  pool.on('error', (err) => {
    console.error(`School DB pool error (${schoolDbName}):`, err);
    // Remove from cache if there's an error
    schoolPools.delete(schoolDbName);
  });

  // Add pool to cache
  schoolPools.set(schoolDbName, pool);

  return pool;
}

module.exports = getSchoolDbPool;