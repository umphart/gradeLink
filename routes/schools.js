const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');
const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads/logos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// School Registration Endpoint
router.post('/register', upload.single('school_logo'), async (req, res) => {
  let client;
  let schoolDb;
  try {
    // Validate required fields
    const requiredFields = [
      'school_name',
      'school_email',
      'school_phone',
      'school_address', 
      'school_city',
      'school_state',
      'admin_firstName',
      'admin_lastName',
      'admin_email',
      'admin_phone',
      'admin_password'
    ];

    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields',
        missingFields: missingFields.join(', ')
      });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // Step 1: Insert school into central DB
    const schoolInsert = `
      INSERT INTO schools (name, email, phone, address, city, state, logo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;

    const schoolResult = await client.query(schoolInsert, [
      req.body.school_name,
      req.body.school_email,
      req.body.school_phone,
      req.body.school_address,
      req.body.school_city,
      req.body.school_state,
      req.file?.filename || null,
    ]);

    const schoolId = schoolResult.rows[0].id;

    // Step 2: Create dedicated database for school
    const dbName = `school_${req.body.school_name.replace(/\s+/g, '_').toLowerCase()}`;
    
    try {
      await client.query('COMMIT');
      console.log(`🛠 Creating database: ${dbName}`);
      await pool.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database created: ${dbName}`);

      // Verify database was created
      const dbCheck = await pool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`, 
        [dbName]
      );
      if (dbCheck.rows.length === 0) {
        throw new Error('Database creation verification failed');
      }
    } catch (error) {
      console.error(`❌ Failed to create database ${dbName}:`, error);
      throw new Error('Database creation failed: ' + error.message);
    }

    // Step 3: Initialize school database tables
    try {
      console.log(`🛠 Initializing tables in ${dbName}`);
      schoolDb = getSchoolDbConnection(dbName);
      
      // Test connection to new database
      const testClient = await schoolDb.connect();
      const testRes = await testClient.query('SELECT NOW()');
      console.log('✅ School DB connection test:', testRes.rows[0]);
      testClient.release();

      await createSchoolTables(schoolDb, dbName);
      
      // Verify tables were created
      const verifyClient = await schoolDb.connect();
      const tables = await verifyClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      console.log('Tables created:', tables.rows.map(t => t.table_name));
      verifyClient.release();
    } catch (err) {
      console.error(`❌ Failed to initialize school database ${dbName}:`, err);
      throw new Error('Failed to initialize school database: ' + err.message);
    }

    // Step 4: Create admin account
    client = await pool.connect();
    await client.query('BEGIN');
    const hashedPassword = await bcrypt.hash(req.body.admin_password, 10);
    await client.query(
      `INSERT INTO admins (first_name, last_name, email, phone, password, school_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.body.admin_firstName,
        req.body.admin_lastName,
        req.body.admin_email,
        req.body.admin_phone,
        hashedPassword,
        schoolId
      ]
    );
    await client.query('COMMIT');

    res.status(201).json({ 
      success: true,
      message: 'School registered successfully',
      schoolId,
      dbName
    });

  } catch (err) {
    console.error('Registration error:', err);
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback error:', rollbackErr);
      }
    }
    if (req.file) fs.unlink(req.file.path, () => {});
    
    res.status(500).json({ 
      success: false,
      message: err.message || 'Registration failed',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  } finally {
    if (client) client.release();
    if (schoolDb) await schoolDb.end();
  }
});

// Helper function to create all school tables
async function createSchoolTables(db, dbName) {
  let client;
  try {
    client = await db.connect();
    console.log(`⏳ Creating tables in database: ${dbName}`);
    
    await client.query('BEGIN');

    // Create core tables first (sessions and terms)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        session_name VARCHAR(20) UNIQUE NOT NULL,
        is_current BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created sessions table');

    await client.query(`
      CREATE TABLE IF NOT EXISTS terms (
        id SERIAL PRIMARY KEY,
        term_name VARCHAR(20) UNIQUE NOT NULL,
        is_current BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created terms table');

    // Create teachers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        school_id INTEGER,
        teacher_id VARCHAR(100) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(20),
        gender VARCHAR(10),
        department VARCHAR(100),
        qualifications TEXT,
        employment_date DATE,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created teachers table');

    // Create subjects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        subject_code VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created subjects table');

    // Create classes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        level VARCHAR(50) NOT NULL,
        section VARCHAR(50),
        class_teacher_id VARCHAR(100) REFERENCES teachers(teacher_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (name, section)
      );
    `);
    console.log('✅ Created classes table');

    // Create student tables by level
    const levels = ['primary', 'junior', 'senior'];
    for (const level of levels) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${level}_students (
          id SERIAL PRIMARY KEY,
          admission_number VARCHAR(100) UNIQUE NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          class_id INTEGER REFERENCES classes(id),
          gender VARCHAR(20),
          date_of_birth DATE,
          address TEXT,
          parent_name VARCHAR(255),
          parent_contact VARCHAR(100),
          medical_info TEXT,
          photo_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log(`✅ Created ${level}_students table`);
    }

    // Create exam tables
    const examTypes = ['first_term', 'second_term', 'third_term'];
    for (const examType of examTypes) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${examType}_exams (
          id SERIAL PRIMARY KEY,
          student_id INTEGER NOT NULL,
          class_id INTEGER REFERENCES classes(id),
          subject_id INTEGER REFERENCES subjects(id),
          session_id INTEGER REFERENCES sessions(id),
          term_id INTEGER REFERENCES terms(id),
          exam_score NUMERIC(5,2) DEFAULT 0,
          ca_score NUMERIC(5,2) DEFAULT 0,
          total_score NUMERIC(5,2) GENERATED ALWAYS AS (exam_score + ca_score) STORED,
          grade VARCHAR(2),
          remark TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (student_id, subject_id, session_id, term_id)
        );
      `);
      console.log(`✅ Created ${examType}_exams table`);
    }

    // Create teacher-subjects relationship
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_subjects (
        id SERIAL PRIMARY KEY,
        teacher_id VARCHAR(100) REFERENCES teachers(teacher_id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        class_ids INTEGER[],
        is_class_teacher BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (teacher_id, subject_id)
      );
    `);
    console.log('✅ Created teacher_subjects table');

    await client.query('COMMIT');
    console.log(`🎉 All tables created successfully in ${dbName}`);
  } catch (err) {
    console.error(`❌ Error creating tables in ${dbName}:`, err);
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

module.exports = router;