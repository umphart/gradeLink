//util/dbSwitcher.
const { Pool } = require('pg');

function getSchoolDbConnection() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { 
      rejectUnauthorized: false 
    } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
}

module.exports = getSchoolDbConnection;