const { Pool } = require('pg');

const dbSelector = (req, res, next) => {
  const schoolName = req.body.schoolName || req.query.schoolName || req.headers['x-school-name'];

  if (!schoolName) {
    return res.status(400).json({ message: 'Missing school name' });
  }

  try {
    // Sanitize school name to prevent SQL injection
    const sanitizedSchoolName = schoolName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    // Create connection pool for the school-specific database
    req.db = new Pool({
      connectionString: `${process.env.DATABASE_URL.split('/').slice(0, -1).join('/')}/school_${sanitizedSchoolName}`,
      ssl: { 
        rejectUnauthorized: false // Required for Render PostgreSQL
      },
      max: 5, // Limit connections per pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    // Verify the database connection
    req.db.query('SELECT 1')
      .then(() => next())
      .catch(err => {
        console.error('Database connection test failed:', err);
        return res.status(500).json({ 
          message: `School database 'school_${sanitizedSchoolName}' not found or inaccessible`
        });
      });
  } catch (err) {
    console.error('Error creating DB pool:', err);
    return res.status(500).json({ message: 'Database configuration error' });
  }
};

module.exports = dbSelector;