// routes/login.js
const express = require('express');
const pool = require('../models/db');
const bcrypt = require('bcryptjs');
const path = require('path'); // Add path module for directory operations
const fs = require('fs'); // Add fs module for file system operations
const router = express.Router();

router.post('/', async (req, res) => {
  // Add validation
  if (!req.body || !req.body.email || !req.body.password) {
    return res.status(400).json({ 
      message: 'Email and password are required',
      receivedBody: req.body
    });
  }

  const { email, password } = req.body;

  try {
    const client = await pool.connect();

    // First, find the user by email only
    const result = await client.query(
      `SELECT a.*, s.name as school_name, s.logo 
       FROM admins a
       JOIN schools s ON a.school_id = s.id
       WHERE a.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      console.error('Failed login attempt for email:', email);
      client.release();
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    
    // Compare the provided password with the hashed password in database
    const passwordMatch = bcrypt.compareSync(password, user.password);
    
    if (!passwordMatch) {
      console.error('Password mismatch for email:', email);
      client.release();
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Enhanced logo logging
    console.log('\n--- Login successful for:', email, '---');
    if (user.logo) {
      console.log('Logo path:', user.logo);
      
      // Extract logo name
      const logoName = user.logo.split('/').pop();
      console.log('Logo name:', logoName);
      
      // Get directory information
      const logoDir = path.dirname(user.logo);
      console.log('Logo directory:', logoDir);
      
      try {
        // Check if logo file exists
        const fullPath = path.join(process.cwd(), 'public', user.logo); // Adjust path as needed
        const fileExists = fs.existsSync(fullPath);
        
        console.log('Logo file exists:', fileExists);
        if (fileExists) {
          console.log('Logo file stats:', fs.statSync(fullPath));
        }
        
        // List directory contents (be careful with this in production)
        console.log('Directory contents:', fs.readdirSync(path.dirname(fullPath)));
      } catch (dirErr) {
        console.error('Error accessing logo directory:', dirErr.message);
      }
    } else {
      console.log('No logo associated with this school');
    }

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
      error: err.message
    });
  }
});

module.exports = router;