// routes/login.js
const express = require('express');
const pool = require('../models/db');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Assuming your logos are stored in the 'public/uploads' directory
const LOGO_BASE_DIR = path.join(process.cwd(), 'public', 'uploads');

router.post('/', async (req, res) => {
  if (!req.body || !req.body.email || !req.body.password) {
    return res.status(400).json({ 
      message: 'Email and password are required',
      receivedBody: req.body
    });
  }

  const { email, password } = req.body;

  try {
    const client = await pool.connect();
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
    const passwordMatch = bcrypt.compareSync(password, user.password);
    
    if (!passwordMatch) {
      console.error('Password mismatch for email:', email);
      client.release();
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    console.log('\n--- Login successful for:', email, '---');
    
    if (user.logo) {
      console.log('Logo path from DB:', user.logo);
      
      // Construct proper file path
      const logoFilename = path.basename(user.logo);
      const logoFullPath = path.join(LOGO_BASE_DIR, logoFilename);
      
      console.log('Expected logo location:', logoFullPath);
      
      try {
        // Check if logo file exists
        const fileExists = fs.existsSync(logoFullPath);
        console.log('Logo file exists:', fileExists);
        
        if (fileExists) {
          const stats = fs.statSync(logoFullPath);
          console.log('Logo file info:', {
            size: `${(stats.size / 1024).toFixed(2)} KB`,
            lastModified: stats.mtime,
            isFile: stats.isFile()
          });
        } else {
          console.log('Possible reasons:');
          console.log('- File was deleted or moved');
          console.log('- Path in database is incorrect');
          console.log('- File permissions issue');
          
          // Check if directory exists
          const dirExists = fs.existsSync(LOGO_BASE_DIR);
          console.log('Logo directory exists:', dirExists);
          
          if (dirExists) {
            console.log('Files in logo directory:', fs.readdirSync(LOGO_BASE_DIR));
          }
        }
      } catch (err) {
        console.error('File system error:', err.message);
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
        logo: user.logo ? `/uploads/${path.basename(user.logo)}` : null,
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