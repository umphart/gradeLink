//router/login.js
const express = require('express');
const pool = require('../models/db');
const router = express.Router();

router.post('/', async (req, res) => {
  const { email, password } = req.body;

  try {
    const client = await pool.connect();

    // Query to get admin details + associated school name and logo
    const result = await client.query(
      `SELECT a.*, s.name as school_name, s.logo 
       FROM admins a
       JOIN schools s ON a.school_id = s.id
       WHERE a.email = $1 AND a.password = $2`, // Checking password directly (no hashing)
      [email, password]
    );

    if (result.rows.length === 0) {
      // Inform the user of invalid credentials
      console.error('Failed login attempt for email:', email);
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    client.release();

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        schoolId: user.school_id,
        schoolName: user.school_name,
        logo: user.logo || null,  // Include logo here
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Add the login route for students
router.post('/students', async (req, res) => {
  const { admissionNumber, password } = req.body;

  // Validation check
  if (!admissionNumber || !password) {
    return res.status(400).json({ message: 'Admission number and password are required.' });
  }

  let centralDb;

  try {
    // Connect to the central database
    centralDb = await pool.connect();

    // Query the students_login table to check if the student exists and validate the password
    const result = await centralDb.query(
      `SELECT * FROM students_login WHERE admission_number = $1 AND password = $2`,
      [admissionNumber, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid admission number or password.' });
    }

    // Student found, send back the student data
    const student = result.rows[0];
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        admissionNumber: student.admission_number,
        schoolName: student.school_name,
        schoolDbName: student.school_db_name,
      },
    });
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message,
    });
  } finally {
    if (centralDb) centralDb.release();
  }
});

module.exports = router;
