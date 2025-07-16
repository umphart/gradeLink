// utils/dbSwitcher.js
const { Pool } = require('pg');

module.exports = (dbName) => {
  return new Pool({
    user: 'school_management_db_xo40_user',
    host: 'dpg-d1s0es95pdvs739p23v0-a.oregon-postgres.render.com',
    database: dbName || 'school_management_db_xo40',
    password: 'nN35caUc34krtF9cO0rYomNscsDGktps',
    port: 5432,
    ssl: { 
      rejectUnauthorized: false 
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
};