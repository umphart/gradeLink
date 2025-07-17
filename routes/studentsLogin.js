const express = require('express');
const pool = require('../models/db'); // Central pool
const getSchoolDbPool = require('../utils/getSchoolDbPool');
const router = express.Router();

// Add connection pool monitoring
pool.on('error', (err) => {
  console.error('Central DB pool error:', err);
});

router.post('/', async (req, res) => {
  const { admissionNumber, password } = req.body;

  if (!admissionNumber || !password) {
    return res.status(400).json({ message: 'Admission number and password are required.' });
  }

  let centralClient;
  let schoolClient;

  try {
    // 1. Authenticate from central DB with connection timeout
    centralClient = await pool.connect();
    console.log('Connected to central DB pool');

    const result = await centralClient.query(
      `SELECT * FROM students_login WHERE admission_number = $1`,
      [admissionNumber]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid admission number or password.' });
    }

    const student = result.rows[0];
    
    // Verify password (should be hashed in production)
    if (student.password !== password) {
      return res.status(401).json({ message: 'Invalid admission number or password.' });
    }

    const { school_db_name, school_name, logo } = student;

    // 2. Connect to school's DB with proper error handling
    const schoolPool = getSchoolDbPool(school_db_name);
    if (!schoolPool) {
      throw new Error(`Could not get pool for school database: ${school_db_name}`);
    }

    schoolClient = await schoolPool.connect().catch(err => {
      console.error('School DB connection error:', err);
      throw new Error('Failed to connect to school database');
    });
    console.log(`Connected to school DB: ${school_db_name}`);

    // 3. Search student in appropriate table
    const tables = ['primary_students', 'junior_students', 'senior_students'];
    let studentDetails;

    for (const table of tables) {
      try {
        const queryResult = await schoolClient.query(
          `SELECT * FROM ${table} WHERE admission_number = $1`,
          [admissionNumber]
        );
        
        if (queryResult.rows.length > 0) {
          studentDetails = queryResult.rows[0];
          console.log(`Found student in ${table} table`);
          break;
        }
      } catch (tableError) {
        if (tableError.code !== '42P01') { // Ignore "table doesn't exist" errors
          console.error(`Error querying ${table}:`, tableError);
        }
        continue;
      }
    }

    if (!studentDetails) {
      return res.status(404).json({ message: 'Student details not found in school database.' });
    }

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
    // Release connections in reverse order
    if (schoolClient) {
      try {
        schoolClient.release();
        console.log('Released school DB connection');
      } catch (releaseErr) {
        console.error('Error releasing school connection:', releaseErr);
      }
    }
    
    if (centralClient) {
      try {
        centralClient.release();
        console.log('Released central DB connection');
      } catch (releaseErr) {
        console.error('Error releasing central connection:', releaseErr);
      }
    }
  }
});

module.exports = router;