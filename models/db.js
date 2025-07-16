const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://school_admin:aProndWWyDXh45O6NeBqRaPFJPuhQvZA@dpg-d1s2s5idbo4c73bu9qkg-a.oregon-postgres.render.com/school_management_aymr_ajcr',
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  allowExitOnIdle: true
});

let retryCount = 0;
const MAX_RETRIES = 3;

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to PostgreSQL');
    const res = await client.query('SELECT NOW()');
    console.log('📅 Database time:', res.rows[0].now);
    client.release();
    retryCount = 0;
  } catch (err) {
    console.error('❌ Connection attempt failed:', err.message);
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`🔄 Retrying connection (${retryCount}/${MAX_RETRIES})...`);
      setTimeout(testConnection, 2000);
    } else {
      console.error('🔥 Max retries reached. Exiting...');
      process.exit(1);
    }
  }
}

testConnection();

pool.on('connect', () => {
  console.log('🟢 New client connection established');
});

pool.on('error', (err) => {
  console.error('🔴 Unexpected error on idle client:', err.message);
});


module.exports = pool;
