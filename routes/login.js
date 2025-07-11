// routes/login.js
const express = require('express');
const pool = require('../models/db');
const router = express.Router();

router.post('/', async (req, res) => {
  // Add validation
  if (!req.body || !req.body.email || !req.body.password) {
    return res.status(400).json({ 
      message: 'Email and password are required',
      receivedBody: req.body // This helps debugging what was actually received
    });
  }

  const { email, password } = req.body;

  try {
    const client = await pool.connect();

    const result = await client.query(
      `SELECT a.*, s.name as school_name, s.logo 
       FROM admins a
       JOIN schools s ON a.school_id = s.id
       WHERE a.email = $1 AND a.password = $2`,
      [email, password]
    );

    if (result.rows.length === 0) {
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
        logo: user.logo || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ 
      message: 'Internal server error',
      error: err.message // Include the actual error message
    });
  }
});

// Student login remains the same
router.post('/students', async (req, res) => {
  // ... existing student login code ...
});

module.exports = router;