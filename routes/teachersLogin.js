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

  try {
    centralDb = await pool.connect();

    // Step 1: Authenticate from central teachers_login
    const result = await centralDb.query(
      `SELECT * FROM teachers_login WHERE teacher_id = $1 AND password = $2`,
      [teacherId, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid ID or password.' });
    }

    const teacher = result.rows[0];
    const { school_db_name, school_name, logo } = teacher;

    // Step 2: Query teacher details in school DB
    const schoolDbPool = await getSchoolDbPool(school_db_name);
    const schoolDb = await schoolDbPool.connect();

    const teacherDetailsRes = await schoolDb.query(
      `SELECT * FROM teachers WHERE teacher_id = $1`,
      [teacherId]
    );

    const teacherDetails = teacherDetailsRes.rows[0];

    if (!teacherDetails) {
      return res.status(404).json({ message: 'Teacher details not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: teacherDetails.id,
        teacherId: teacherDetails.teacher_id,
        fullName: teacherDetails.teacher_name,
        email: teacherDetails.email,
        phone: teacherDetails.phone,
        department: teacherDetails.department,
        photoUrl: teacherDetails.photo_url,
        gender: teacherDetails.gender,
        schoolName: school_name,
        schoolDbName: school_db_name,
        logo,
      },
    });

  } catch (err) {
    console.error('Teacher login error:', err.stack || err.message || err);
    return res.status(500).json({ 
      message: 'Internal server error', 
      error: err.stack || err.message || 'Unknown error' 
    });
  } finally {
    if (centralDb) centralDb.release();
  }
});

module.exports = router;