const express = require('express');
const multer = require('multer');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const bcrypt = require('bcrypt');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');
const router = express.Router();
const { body, validationResult } = require('express-validator');

// Configure AWS S3 for file uploads
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET_NAME,
    acl: 'public-read',
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `school-logos/${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

const validateRegistration = [
  body('data').exists().withMessage('Registration data is required'),
  body('school.name').notEmpty().withMessage('School name is required'),
  body('admin.email').isEmail().withMessage('Valid email is required'),
  body('admin.password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
];

router.post('/register', upload.single('schoolLogo'), validateRegistration, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false,
      message: 'Validation failed',
      errors: errors.array() 
    });
  }

  let client;
  let schoolDb;
  try {
    const { school, admin } = JSON.parse(req.body.data);
    const logoUrl = req.file?.location || null;

    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Insert school into central database
    const schoolInsertQuery = `
      INSERT INTO schools (name, email, phone, address, city, state, logo_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;

    const schoolResult = await client.query(schoolInsertQuery, [
      school.name,
      school.email,
      school.phone,
      school.address?.street || '',
      school.address?.city || '',
      school.address?.state || '',
      logoUrl
    ]);

    const schoolId = schoolResult.rows[0].id;
    const schemaName = `school_${schoolId}`; // Use ID instead of name for security

    // 2. Create schema for school (instead of separate database)
    try {
      await client.query(`CREATE SCHEMA ${schemaName}`);
      console.log(`✅ Schema created: ${schemaName}`);
    } catch (error) {
      console.error(`❌ Failed to create schema ${schemaName}:`, error);
      await client.query('ROLLBACK');
      return res.status(500).json({ 
        success: false,
        message: 'Schema creation failed',
        error: error.message 
      });
    }

    // 3. Initialize school schema
    try {
      schoolDb = getSchoolDbConnection(); // Same database, different schema
      await createSchoolSchema(schoolDb, schemaName);

      // 4. Insert admin user with hashed password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(admin.password, saltRounds);
      
      await client.query('BEGIN');
      const adminInsertQuery = `
        INSERT INTO admins (first_name, last_name, email, phone, password, school_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
      `;
      
      await client.query(adminInsertQuery, [
        admin.firstName,
        admin.lastName,
        admin.email,
        admin.phone,
        hashedPassword,
        schoolId
      ]);
      
      await client.query('COMMIT');

      res.status(201).json({ 
        success: true,
        message: 'School registered successfully',
        schoolId,
        schemaName
      });

    } catch (err) {
      console.error('School initialization error:', err);
      await client.query('ROLLBACK');
      
      // Cleanup created schema if initialization failed
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      } catch (cleanupError) {
        console.error('Failed to cleanup schema:', cleanupError);
      }

      res.status(500).json({ 
        success: false,
        message: 'School initialization failed',
        error: err.message 
      });
    }

  } catch (err) {
    console.error('Registration error:', err);
    if (client) await client.query('ROLLBACK');
    res.status(500).json({ 
      success: false,
      message: 'Registration failed',
      error: err.message 
    });
  } finally {
    if (client) client.release();
    if (schoolDb) await schoolDb.end();
  }
});

// Helper function to create school database schema
async function createSchoolSchema(db, schemaName) {
  try {
    // Create tables within the schema
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.students (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        admission_number VARCHAR(100) NOT NULL UNIQUE,
        grade_level VARCHAR(20) CHECK (grade_level IN ('primary', 'junior', 'senior')),
        class_name VARCHAR(100),
        section VARCHAR(50),
        gender VARCHAR(20),
        date_of_birth DATE,
        phone VARCHAR(20),
        guidance_name VARCHAR(255),
        guidance_contact VARCHAR(100),
        disability_status TEXT,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.sessions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(20) UNIQUE NOT NULL,
        is_current BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.terms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(20) UNIQUE NOT NULL,
        is_current BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        level VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${schemaName}.exams (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES ${schemaName}.students(id),
        class_id INTEGER REFERENCES ${schemaName}.classes(id),
        subject VARCHAR(100) NOT NULL,
        exam_score DECIMAL(5,2),
        ca_score DECIMAL(5,2),
        total_score DECIMAL(5,2),
        remark TEXT,
        session_id INTEGER REFERENCES ${schemaName}.sessions(id),
        term_id INTEGER REFERENCES ${schemaName}.terms(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log(`✅ Successfully initialized schema: ${schemaName}`);
  } catch (err) {
    console.error(`❌ Failed to initialize schema ${schemaName}:`, err);
    throw err;
  }
}

module.exports = router;