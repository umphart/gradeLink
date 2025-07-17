const express = require('express');
const pool = require('../models/db'); // Central pool
const getSchoolDbPool = require('../utils/getSchoolDbPool');
const router = express.Router();

router.post('/', async (req, res) => {
  const { admissionNumber, password } = req.body;

  if (!admissionNumber || !password) {
    return res.status(400).json({ message: 'Admission number and password are required.' });
  }

  let centralDb;
  let schoolDb;

  try {
    // 1. Authenticate from central DB
    centralDb = await pool.connect();
    const result = await centralDb.query(
      `SELECT * FROM students_login WHERE admission_number = $1 AND password = $2`,
      [admissionNumber, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid admission number or password.' });
    }

    const student = result.rows[0];
    const { school_db_name, school_name, logo } = student;

    // 2. Connect to correct school's DB
    const schoolDbPool = getSchoolDbPool(school_db_name);
    schoolDb = await schoolDbPool.connect();

    const tables = ['primary_students', 'junior_students', 'senior_students'];
    let studentDetails;

    for (const table of tables) {
      try {
        const queryResult = await schoolDb.query(
          `SELECT * FROM ${table} WHERE admission_number = $1`,
          [admissionNumber]
        );
        if (queryResult.rows.length > 0) {
          studentDetails = queryResult.rows[0];
          break;
        }
      } catch (tableError) {
        // Table doesn't exist, try next one
        continue;
      }
    }

    if (!studentDetails) {
      return res.status(404).json({ message: 'Student details not found in school database.' });
    }
console.log('studentDetails:', studentDetails);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: studentDetails.id,
        admissionNumber: studentDetails.admission_number,
        fullName: studentDetails.full_name,
        className: studentDetails.class_name,
        section: studentDetails.section,
        gender: studentDetails.gender,
        age: studentDetails.age,
        guidanceName: studentDetails.guidance_name,
        guidanceContact: studentDetails.guidance_contact,
        photoUrl: studentDetails.photo_url,
        createdAt: studentDetails.created_at,
        schoolName: school_name,
        schoolDbName: school_db_name,
        logo,
      },
      
    });


  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  } finally {
    if (centralDb) centralDb.release();
    if (schoolDb) schoolDb.release();
  }
});

module.exports = router;