const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../models/db'); // Main database connection

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const client = await pool.connect();

    // Query to get admin + school name and logo
    const result = await client.query(
      `SELECT a.*, s.name as school_name, s.logo 
       FROM admins a
       JOIN schools s ON a.school_id = s.id
       WHERE a.email = $1 AND a.password = $2`,
      [email, password] // directly comparing email and password
    );

    client.release();

    if (result.rows.length === 0) {
      // Inform the user of invalid credentials
      console.error('Failed login attempt for email:', email);
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Generate JWT with user data (including schoolId)
    const token = jwt.sign(
      { userId: user.id, email: user.email, schoolId: user.school_id }, // Include schoolId in payload
      process.env.JWT_SECRET || 'myscretkey', // Secret key for JWT (make sure to change this for production)
      { expiresIn: '1h' } // Token expires in 1 hour
    );

    // Send the token back to the client
    res.json({ token });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
