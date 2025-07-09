const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

app.use((req, res, next) => {
  console.log(`🔍 ${req.method} ${req.url}`);
  next();
})
// Registration endpoint
app.post('/schools/register', upload.single('schoolLogo'), async (req, res) => {
  let client;
  try {
    // Map flat field names to structured objects
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(school.email)) {
      return res.status(400).json({ success: false, message: 'Invalid school email format' });
    }
    if (!emailRegex.test(admin.email)) {
      return res.status(400).json({ success: false, message: 'Invalid admin email format' });
    }

    client = await pool.connect();

    // Check existing emails
    const checkQuery = `
      SELECT EXISTS(SELECT 1 FROM schools WHERE email = $1) AS school_exists,
             EXISTS(SELECT 1 FROM admins WHERE email = $2) AS admin_exists
    `;
    const { rows: [{ school_exists, admin_exists }] } = await client.query(checkQuery, [school.email, admin.email]);

    if (school_exists || admin_exists) {
      return res.status(409).json({
        success: false,
        message: school_exists
          ? 'School with this email already exists'
          : 'Admin with this email already exists'
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Insert school
    const schoolQuery = `
      INSERT INTO schools (name, email, phone, address, city, state, logo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;
    const schoolResult = await client.query(schoolQuery, [
      school.name,
      school.email,
      school.phone || null,
      school.address,
      school.city || null,
      school.state || null,
      req.file?.filename || null
    ]);

    const schoolId = schoolResult.rows[0].id;

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
    console.error('🔥 Server Registration Error:', error);

    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
    console.log('Received form data:', req.body);
console.log('Received file:', req.file);

  } finally {
    client?.release();
  }
});

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key'; // Use env in production

// Admin login route
app.post('/admins/login', async (req, res) => {
  const { email, password } = req.body;
  let client;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    client = await pool.connect();

    // Find admin by email
    const adminResult = await client.query(
      'SELECT * FROM admins WHERE email = $1',
      [email]
    );

    if (adminResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const admin = adminResult.rows[0];

    // Compare password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Fetch school info
    const schoolResult = await client.query(
      'SELECT name, logo FROM schools WHERE id = $1',
      [admin.school_id]
    );

    const school = schoolResult.rows[0];
    console.log('🏫 Logged-in admin school info:', school); // Log school info to console

    // Generate JWT token
    const token = jwt.sign(
      { id: admin.id, email: admin.email, school_id: admin.school_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        schoolId: admin.school_id,
        schoolName: school?.name || null,
        logo: school?.logo || null
      }
    });

  } catch (error) {
    console.error('🔥 Admin Login Error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  } finally {
    client?.release();
  }
});


app.get('/', (req, res) => {
  res.send('GradeLink API is running ✅');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
