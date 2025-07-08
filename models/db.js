const { Pool } = require('pg');

// Configure the main database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render PostgreSQL
  },
  max: 5, // Limit the number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000 // Return an error after 2 seconds if connection couldn't be established
});

// Test the database connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('✅ Connected to PostgreSQL database'))
  .catch(err => console.error('❌ Database connection error:', err));

module.exports = {
  pool,
  // Function to get a school-specific database connection
  getSchoolDbConnection: (dbName) => {
    const connectionString = `${process.env.DATABASE_URL.split('/').slice(0, -1).join('/')}/${dbName}`;
    
    return new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 2 // Use smaller pool for school-specific databases
    });
  }
};