const { Pool } = require('pg');

function getSchoolDbPool(schoolDbName) {
  return new Pool({
    connectionString: `postgres://school_admin:gF3BgZ6FIZJ6A0dIUyhjtRA9cZ4o7VBe@dpg-d1mfbe2dbo4c73f8apig-a.oregon-postgres.render.com:5432/${schoolDbName}`,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

module.exports = getSchoolDbPool;
