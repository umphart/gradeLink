// utils/dbSwitcher.js
const { Pool } = require('pg');

module.exports = (dbName) => {
  return new Pool({
    user: 'school_admin',
    host: 'dpg-d1mfbe2dbo4c73f8apig-a.oregon-postgres.render.com',
    database: dbName,
    password: 'gF3BgZ6FIZJ6A0dIUyhjtRA9cZ4o7VBe',
    port: 5432,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
};