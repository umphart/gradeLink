require('dotenv').config();
const { Pool } = require('pg');

function getSchoolDbPool(schoolDbName) {
  return new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: schoolDbName,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

module.exports = getSchoolDbPool;
