const express = require('express');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const router = express.Router();

// Configure storage for school logos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/logos/');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `logo-${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (validMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, or WebP images are allowed!'), false);
    }
  }
});

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.post('/register', upload.single('schoolLogo'), async (req, res) => {
  let client;
  try {
    // Validate request
    if (!req.body.data) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing registration data' 
      });
    }

    const { school, admin } = JSON.parse(req.body.data);
    
    // Validate required fields
    const requiredFields = {
      school: ['name', 'email'],
      admin: ['firstName', 'lastName', 'email', 'password']
    };

    const missingFields = [];
    for (const field of requiredFields.school) {
      if (!school[field]) missingFields.push(`School ${field}`);
    }
    for (const field of requiredFields.admin) {
      if (!admin[field]) missingFields.push(`Admin ${field}`);
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate email formats
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(school.email) || !emailRegex.test(admin.email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate password strength
    if (admin.password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    client = await pool.connect();

    // Check if school or admin email already exists
    const checkQuery = `
      SELECT EXISTS(SELECT 1 FROM schools WHERE email = $1) AS school_exists,
             EXISTS(SELECT 1 FROM admins WHERE email = $2) AS admin_exists
    `;
    const { rows: [{ school_exists, admin_exists }] } = await client.query(
      checkQuery, 
      [school.email, admin.email]
    );
    
    if (school_exists || admin_exists) {
      return res.status(409).json({
        success: false,
        message: school_exists 
          ? 'School with this email already exists' 
          : 'Admin with this email already exists'
      });
    }

    // Begin transaction
    await client.query('BEGIN');

    // Hash admin password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(admin.password, saltRounds);

    // Insert school
    const schoolInsertQuery = `
      INSERT INTO schools (name, email, phone, address, city, state, logo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;

    const schoolResult = await client.query(schoolInsertQuery, [
      school.name,
      school.email,
      school.phone || null,
      school.address?.street || null,
      school.address?.city || null,
      school.address?.state || null,
      req.file?.filename || null
    ]);

    const schoolId = schoolResult.rows[0].id;

    // Insert admin
    const adminInsertQuery = `
      INSERT INTO admins (first_name, last_name, email, phone, password, school_id, role)
      VALUES ($1, $2, $3, $4, $5, $6, 'superadmin')
      RETURNING id, email;
    `;
    
    const adminResult = await client.query(adminInsertQuery, [
      admin.firstName,
      admin.lastName,
      admin.email,
      admin.phone || null,
      hashedPassword,
      schoolId
    ]);

    await client.query('COMMIT');

    res.status(201).json({ 
      success: true,
      message: 'School registered successfully',
      data: {
        schoolId,
        adminId: adminResult.rows[0].id,
        adminEmail: adminResult.rows[0].email
      }
    });

  } catch (err) {
    console.error('Registration error:', err);
    if (client) await client.query('ROLLBACK');
    
    const statusCode = err.code === '23505' ? 409 : 500;
    const message = err.code === '23505' ? 
      'A school or admin with these details already exists' : 
      'Registration failed';

    res.status(statusCode).json({ 
      success: false,
      message,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;