const { Pool } = require('pg');

// Helper to dynamically connect to a different school DB
module.exports = (dbName) => {
  return new Pool({
    user: 'school_admin',
    host: 'dpg-d1s2s5idbo4c73bu9qkg-a.oregon-postgres.render.com',
    database: dbName,
    password: 'aProndWWyDXh45O6NeBqRaPFJPuhQvZA',
    port: 5432,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
};
