const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');
const router = express.Router();

// Configure storage for school logos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/logos/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
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
    const logoFile = req.file;

    // Basic validation
    if (!school.name || !admin.email || !admin.password) {
      return res.status(400).json({
        success: false,
        message: 'School name, admin email and password are required'
      });
    }

    client = await pool.connect();

    // Begin transaction
    await client.query('BEGIN');

    // 1. Insert school into central database
    const schoolInsertQuery = `
      INSERT INTO schools (name, email, phone, address, city, state, logo)
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
      logoFile?.filename || null
    ]);

    const schoolId = schoolResult.rows[0].id;

    // 2. Create dedicated database for school
    const dbName = `school_${school.name.replace(/\s+/g, '_').toLowerCase()}`;
    
    try {
      await client.query('COMMIT'); // Commit before creating new database
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database created: ${dbName}`);
    } catch (error) {
      console.error(`❌ Failed to create database ${dbName}:`, error);
      await client.query('ROLLBACK');
      return res.status(500).json({ 
        success: false,
        message: 'Database creation failed',
        error: error.message 
      });
    }

    // 3. Initialize school database schema
    try {
      const schoolDb = getSchoolDbConnection(dbName);
      
      // Create all required tables
      await createSchoolSchema(schoolDb, dbName);

      // 4. Insert admin user
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
        admin.password,
        schoolId
      ]);
      
      await client.query('COMMIT');

      res.status(201).json({ 
        success: true,
        message: 'School registered successfully',
        schoolId,
        dbName
      });

    } catch (err) {
      console.error('School initialization error:', err);
      await client.query('ROLLBACK');
      
      // Attempt to clean up created database if initialization failed
      try {
        await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
      } catch (cleanupError) {
        console.error('Failed to cleanup database:', cleanupError);
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
  }
});

// Helper function to create school database schema
async function createSchoolSchema(schoolDb, dbName) {
  try {
    // Create student tables
    const gradeLevels = ['primary', 'junior', 'senior'];
    for (const grade of gradeLevels) {
      await schoolDb.query(`
        CREATE TABLE IF NOT EXISTS ${grade}_students (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(255) NOT NULL,
          admission_number VARCHAR(100) NOT NULL,
          studentId VARCHAR(50),
          class_name VARCHAR(100),
          section VARCHAR(50),
          gender VARCHAR(20),
          age INTEGER,
          phone VARCHAR(20),
          guidance_name VARCHAR(255),
          guidance_contact VARCHAR(100),
          disability_status TEXT,
          photo_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log(`✅ ${grade}_students table created`);
    }

    // Create sessions table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        session_name VARCHAR(20) UNIQUE NOT NULL,
        is_current BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create terms table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS terms (
        id SERIAL PRIMARY KEY,
        term_name VARCHAR(20) UNIQUE NOT NULL,
        is_current BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create classes table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        class_name VARCHAR(50) UNIQUE NOT NULL,
        level VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create exam tables for all classes
    const allClasses = [
      'primary1', 'primary2', 'primary3', 'primary4', 'primary5',
      'jss1', 'jss2', 'jss3',
      'ss1', 'ss2', 'ss3'
    ];

    for (const className of allClasses) {
      await schoolDb.query(`
        CREATE TABLE IF NOT EXISTS ${className}_exam (
          id SERIAL PRIMARY KEY,
          school_id INTEGER,
          student_name VARCHAR(255) NOT NULL,
          admission_number VARCHAR(100) NOT NULL,
          class_name VARCHAR(100),
          subject VARCHAR(100),
          exam_mark INTEGER,
          ca INTEGER,
          total INTEGER,
          remark TEXT,
          average FLOAT,
          position INTEGER,
          session_id INTEGER REFERENCES sessions(id),
          term_id INTEGER REFERENCES terms(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }

    // Create teachers table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        school_id INTEGER,
        teacher_id VARCHAR(100) UNIQUE NOT NULL,
        teacher_name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        teacherID VARCHAR(50),
        gender VARCHAR(10),
        department VARCHAR(100),
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create subjects table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        subject_name VARCHAR(255) NOT NULL,
        description TEXT,
        classname VARCHAR(100), 
        subject_code VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create teacher_subjects table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS teacher_subjects (
        id SERIAL PRIMARY KEY,
        teacher_id VARCHAR(50) REFERENCES teachers(teacher_id) ON DELETE CASCADE,
        teacher_name VARCHAR(100),
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        subject_name VARCHAR(100),
        subject_code VARCHAR(20),
        classname VARCHAR(100),
        UNIQUE (teacher_id, subject_id)
      );
    `);

    // Create teacher_classes table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS teacher_classes (
        id SERIAL PRIMARY KEY,
        teacher_id VARCHAR(50) REFERENCES teachers(teacher_id) ON DELETE CASCADE,
        teacher_name VARCHAR(100),
        teacher_code VARCHAR(50),
        class_name VARCHAR(50),
        section VARCHAR(50),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (class_name, section)
      );
    `);

    // Create attendance table
    await schoolDb.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        class_name VARCHAR(50) NOT NULL,
        date DATE NOT NULL,
        status VARCHAR(10) NOT NULL CHECK (status IN ('present', 'absent', 'late')),
        remark TEXT,
        recorded_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (student_id, date)
      );
    `);

    console.log(`✅ Successfully initialized schema for ${dbName}`);
  } catch (err) {
    console.error(`❌ Failed to initialize schema for ${dbName}:`, err);
    throw err; // Re-throw to be caught by the calling function
  }
}

module.exports = router;