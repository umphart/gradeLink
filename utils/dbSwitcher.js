const { Pool } = require('pg');

function getSchoolDbConnection(schoolDbName) {
  return new Pool({
    user: 'postgres',
    host: 'localhost',
    database: schoolDbName,
    password: '001995',
    port: 5432,
  });
}

module.exports = getSchoolDbConnection;
