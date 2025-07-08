const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();

// CORS Configuration
app.use(cors({
  origin: [
    'https://grade-linkfrontend.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Registration endpoint
app.post('/schools/register', upload.single('schoolLogo'), async (req, res) => {
  let client;
  try {
    const school = {
  name: req.body.school_name,
  email: req.body.school_email,
  phone: req.body.school_phone,
  address: req.body.school_address,
  city: req.body.school_city,
  state: req.body.school_state
};

const admin = {
  firstName: req.body.admin_firstName,
  lastName: req.body.admin_lastName,
  email: req.body.admin_email,
  phone: req.body.admin_phone,
  password: req.body.admin_password
};

    
    // Validate required fields
    const requiredFields = {
      school: ['name', 'email', 'address'],
      admin: ['firstName', 'lastName', 'email', 'password']
    };

    const missingFields = [];
    for (const field of requiredFields.school) {
      if (!school?.[field]) missingFields.push(`School ${field}`);
    }
    for (const field of requiredFields.admin) {
      if (!admin?.[field]) missingFields.push(`Admin ${field}`);
    }

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
   if (!emailRegex.test(school.email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid school email format'
      });
    }

    if (!emailRegex.test(admin.email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin email format'
      });
    }

    client = await pool.connect();

    // Check if email already exists
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

    // Insert school
    const schoolQuery = `
      INSERT INTO schools (name, email, phone, address, city, state, logo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;
    const schoolRes = await client.query(schoolQuery, [
      school.name,
      school.email,
      school.phone || null,
      school.address,
      school.city || null,
      school.state || null,
      req.file?.filename || null
    ]);

    const schoolId = schoolRes.rows[0].id;

    // Hash password and insert admin
    const hashedPassword = await bcrypt.hash(admin.password, 10);
    const adminQuery = `
      INSERT INTO admins (first_name, last_name, email, phone, password, school_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    await client.query(adminQuery, [
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
      message: 'Registration successful',
      schoolId
    });

  } catch (error) {
  await client?.query('ROLLBACK');

  console.error('Server Registration Error:', error); // Add this line to see real cause

  res.status(500).json({
    success: false,
    message: 'Registration failed',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
finally {
    client?.release();
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});