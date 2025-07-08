const { Pool } = require('pg');

const dbSelector = (req, res, next) => {
  const schoolName = req.body.schoolName || req.query.schoolName || req.headers['x-school-name'];

  if (!schoolName) {
    return res.status(400).json({ message: 'Missing school name' });
  }

  try {
    // Attach pool to request
    req.db = new Pool({
      user: 'postgres',
      host: 'localhost',
      password: '001995',
      database: `school_${schoolName}`,
      port: 5432,
    });

    next();
  } catch (err) {
    console.error('Error creating DB pool:', err);
    return res.status(500).json({ message: 'Database connection error' });
  }
};

module.exports = dbSelector;
