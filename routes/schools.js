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
    // Validate required fields (using snake_case to match frontend)
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

    // Step 1: Insert school into central DB (using snake_case fields)
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
      await client.query('COMMIT'); // End current transaction
      await pool.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database created: ${dbName}`);
    } catch (error) {
      console.error(`❌ Failed to create database ${dbName}:`, error);
      throw new Error('Database creation failed');
    }

    // Step 3: Initialize school database tables
    try {
      const schoolDb = getSchoolDbConnection(dbName);
      await createSchoolTables(schoolDb, dbName);
      await schoolDb.end();
    } catch (err) {
      console.error(`❌ Failed to initialize school database ${dbName}:`, err);
      throw new Error('Failed to initialize school database');
    }

    // Step 4: Create admin account (using snake_case fields)
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
      schoolId
    });

  } catch (err) {
    console.error('Registration error:', err);
    if (client) await client.query('ROLLBACK');
    if (req.file) fs.unlink(req.file.path, () => {});
    
    res.status(500).json({ 
      success: false,
      message: err.message || 'Registration failed',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  } finally {
    if (client) client.release();
  }
});

async function createSchoolTables(db, dbName) {
  let client;
  try {
    client = await db.connect();
    console.log(`⏳ Creating tables in database: ${dbName}`);
    
    // Create all tables in a transaction
    await client.query('BEGIN');
    
    // Create student tables
    const gradeLevels = ['primary', 'junior', 'senior'];
    for (const grade of gradeLevels) {
      await client.query(`
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
      console.log(`✅ Created ${grade}_students table`);
    }

    // Create sessions and terms tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        session_name VARCHAR(20) UNIQUE NOT NULL 
      );
    `);
    console.log('✅ Created sessions table');

    await client.query(`
      CREATE TABLE IF NOT EXISTS terms (
        id SERIAL PRIMARY KEY,
        term_name VARCHAR(20) UNIQUE NOT NULL 
      );
    `);
    console.log('✅ Created terms table');

    // Create exam tables for all classes
    const allClasses = [
      'primary1', 'primary2', 'primary3', 'primary4', 'primary5',
      'jss1', 'jss2', 'jss3',
      'ss1', 'ss2', 'ss3'
    ];

    for (const className of allClasses) {
      await client.query(`
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
      console.log(`✅ Created ${className}_exam table`);
    }

    // Create teachers table
    await client.query(`
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
    console.log('✅ Created teachers table');

    // Create subjects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        subject_name VARCHAR(255) NOT NULL,
        description TEXT,
        classname VARCHAR(100), 
        subject_code VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created subjects table');

    // Create teacher-subjects relationship table
    await client.query(`
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
    console.log('✅ Created teacher_subjects table');

    // Create teacher-classes relationship table
    await client.query(`
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
    console.log('✅ Created teacher_classes table');

    await client.query('COMMIT');
    console.log(`🎉 All tables created successfully in ${dbName}`);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error(`❌ Error creating tables in ${dbName}:`, err);
    throw err;
  } finally {
    if (client) client.release();
  }
}

module.exports = router;