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
router.post('/register', upload.single('logo'), async (req, res) => {
  let client;
  try {
    // Validate request body
    if (!req.body.name || !req.body.email || !req.body.adminEmail || !req.body.adminPassword) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields' 
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
      req.body.name,
      req.body.email,
      req.body.phone,
      req.body.address,
      req.body.city,
      req.body.state,
      req.file?.filename || null,
    ]);

    const schoolId = schoolResult.rows[0].id;

    // Step 2: Create dedicated database for school
    const dbName = `school_${req.body.name.replace(/\s+/g, '_').toLowerCase()}`;
    
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

    // Step 4: Create admin account
    await client.query('BEGIN');
    const hashedPassword = await bcrypt.hash(req.body.adminPassword, 10);
    await client.query(
      `INSERT INTO admins (first_name, last_name, email, phone, password, school_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.body.adminFirstName,
        req.body.adminLastName,
        req.body.adminEmail,
        req.body.adminPhone,
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
      message: err.message || 'Registration failed'
    });
  } finally {
    if (client) client.release();
  }
});

// Helper function to create all school tables
async function createSchoolTables(db, dbName) {
  // Create student tables
  const gradeLevels = ['primary', 'junior', 'senior'];
  for (const grade of gradeLevels) {
    await db.query(`
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
  }

  // Create sessions and terms tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      session_name VARCHAR(20) UNIQUE NOT NULL 
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS terms (
      id SERIAL PRIMARY KEY,
      term_name VARCHAR(20) UNIQUE NOT NULL 
    );
  `);

  // Create exam tables for all classes
  const allClasses = [
    'primary1', 'primary2', 'primary3', 'primary4', 'primary5',
    'jss1', 'jss2', 'jss3',
    'ss1', 'ss2', 'ss3'
  ];

  for (const className of allClasses) {
    await db.query(`
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
  await db.query(`
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY,
      subject_name VARCHAR(255) NOT NULL,
      description TEXT,
      classname VARCHAR(100), 
      subject_code VARCHAR(100) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create teacher-subjects relationship table
  await db.query(`
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

  // Create teacher-classes relationship table
  await db.query(`
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
}

module.exports = router;