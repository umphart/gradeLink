const { Pool } = require('pg');

function getSchoolDbPool(schoolDbName) {
  return new Pool({
    connectionString: `postgresql://school_admin:aProndWWyDXh45O6NeBqRaPFJPuhQvZA@dpg-d1s2s5idbo4c73bu9qkg-a.oregon-postgres.render.com:5432/${schoolDbName}`,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

module.exports = getSchoolDbPool;
