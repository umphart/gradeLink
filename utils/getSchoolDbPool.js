const { Pool } = require('pg');

const getSchoolDbPool = (dbName) => {
  return new Pool({
 user: 'postgres',
    host: 'localhost',
    database: dbName,
    password: '001995',
    port: 5432,
  });
};

module.exports = getSchoolDbPool;
