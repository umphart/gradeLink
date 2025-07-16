// utils/dbSwitcher.js
const { Pool } = require('pg');
require('dotenv').config();

// Validate database name to prevent SQL injection
const validateDbName = (dbName) => {
  if (!dbName || !/^[a-z0-9_]+$/i.test(dbName)) {
    throw new Error('Invalid database name format');
  }
  return dbName;
};

module.exports = (dbName) => {
  // Validate input
  const validatedDbName = validateDbName(dbName);
  
  return new Pool({
    user: process.env.DB_USER || 'school_admin',
    host: process.env.DB_HOST || 'dpg-d1s2s5idbo4c73bu9qkg-a.oregon-postgres.render.com',
    database: validatedDbName,
    password: process.env.DB_PASSWORD || 'aProndWWyDXh45O6NeBqRaPFJPuhQvZA',
    port: parseInt(process.env.DB_PORT) || 5432,
    ssl: { 
      rejectUnauthorized: process.env.NODE_ENV === 'production' 
    },
    max: parseInt(process.env.DB_POOL_MAX) || 5,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 5000,
    application_name: `school_app_${validatedDbName}`
  });
};