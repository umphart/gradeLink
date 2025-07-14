const express = require('express');
const pool = require('../models/db'); // Central DB
const getSchoolDbPool = require('../utils/getSchoolDbPool');
const router = express.Router();

router.post('/', async (req, res) => {
  const { teacherId, password } = req.body;

  if (!teacherId || !password) {
    return res.status(400).json({ message: 'Teacher ID and password are required.' });
  }

  let centralDb;
  let schoolDb;

  try {
    centralDb = await pool.connect();

    // Get ALL matching records (since UNIQUE constraint removed)
    const result = await centralDb.query(
      `SELECT * FROM teachers_login WHERE teacher_id = $1`,
      [teacherId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid ID or password.' });
    }

    // Find first record with matching password
    const teacher = result.rows.find(row => {
      // In production: use bcrypt.compareSync(password, row.password)
      return row.password === password; 
    });

    if (!teacher) {
      return res.status(401).json({ message: 'Invalid ID or password.' });
    }

    const { school_db_name, school_name, logo } = teacher;

    // Get school-specific connection
    const schoolDbPool = await getSchoolDbPool(school_db_name);
    schoolDb = await schoolDbPool.connect();

    const teacherDetailsRes = await schoolDb.query(
      `SELECT * FROM teachers WHERE teacher_id = $1`,
      [teacherId]
    );

    if (teacherDetailsRes.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher details not found.' });
    }

    const teacherDetails = teacherDetailsRes.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        ...teacherDetails,
        schoolName: school_name,
        schoolDbName: school_db_name,
        logo,
      },
    });

  } catch (err) {
    console.error('Teacher login error:', err);
    return res.status(500).json({ 
      message: 'Internal server error', 
      error: err.message 
    });
  } finally {
    if (centralDb) centralDb.release();
    if (schoolDb) schoolDb.release();
  }
});

module.exports = router;
