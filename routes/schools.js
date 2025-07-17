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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'));
    }
  }
});

// School Registration Endpoint
// School Registration Endpoint
router.post('/register', upload.single('school_logo'), async (req, res) => {
  let client;
  let schoolDb;
  
  // Start registration logging
  console.log('\n=== NEW SCHOOL REGISTRATION STARTED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Request Body:', JSON.stringify(req.body, null, 2));
  
  if (req.file) {
    console.log('School Logo Uploaded:', {
      originalName: req.file.originalname,
      storedPath: req.file.path,
      size: `${(req.file.size / 1024).toFixed(2)} KB`,
      mimeType: req.file.mimetype
    });
  } else {
    console.log('No school logo uploaded');
  }

  try {
    // Validate required fields
    const requiredFields = [
      'school_name', 'school_email', 'school_phone', 'school_address', 
      'school_city', 'school_state', 'admin_firstName', 'admin_lastName',
      'admin_email', 'admin_phone', 'admin_password'
    ];

    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields.join(', '));
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields',
        missingFields: missingFields.join(', ')
      });
    }

    // Log school data
    console.log('\n=== SCHOOL INFORMATION ===');
    console.log('School Name:', req.body.school_name);
    console.log('Email:', req.body.school_email);
    console.log('Phone:', req.body.school_phone);
    console.log('Address:', req.body.school_address);
    console.log('City:', req.body.school_city);
    console.log('State:', req.body.school_state);
    console.log('Logo Filename:', req.file?.filename || 'None');

    // Log admin data
    console.log('\n=== ADMIN INFORMATION ===');
    console.log('First Name:', req.body.admin_firstName);
    console.log('Last Name:', req.body.admin_lastName);
    console.log('Email:', req.body.admin_email);
    console.log('Phone:', req.body.admin_phone);
    console.log('Password:', '********'); // Don't log actual password

    client = await pool.connect();
    await client.query('BEGIN');

    // Step 1: Insert school into central DB
    const schoolInsert = `
      INSERT INTO schools (name, email, phone, address, city, state, logo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;

    console.log('\n=== DATABASE OPERATIONS ===');
    console.log('Inserting school into central database...');
    
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
    console.log('✅ School created with ID:', schoolId);

    // Step 2: Create dedicated database for school
    const dbName = `school_${req.body.school_name.replace(/\s+/g, '_').toLowerCase()}`;
    console.log('\nCreating dedicated database:', dbName);
    
    try {
      await client.query('COMMIT');
      console.log('🛠 Creating database:', dbName);
      await pool.query(`CREATE DATABASE ${dbName}`);
      console.log('✅ Database created:', dbName);

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
      console.log(`\n🛠 Initializing tables in ${dbName}`);
      schoolDb = getSchoolDbConnection(dbName);
      
      // Test connection to new database
      const testClient = await schoolDb.connect();
      const testRes = await testClient.query('SELECT NOW()');
      console.log('✅ School DB connection test successful');
      testClient.release();

      await createSchoolTables(schoolDb, dbName);
      
      // Verify tables were created
      const verifyClient = await schoolDb.connect();
      const tables = await verifyClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      console.log('✅ Tables created:', tables.rows.map(t => t.table_name));
      verifyClient.release();
    } catch (err) {
      console.error(`❌ Failed to initialize school database ${dbName}:`, err);
      throw new Error('Failed to initialize school database: ' + err.message);
    }

    // Step 4: Create admin account
    console.log('\nCreating admin account...');
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
    console.log('✅ Admin account created successfully');

    console.log('\n=== REGISTRATION COMPLETE ===');
    console.log('School ID:', schoolId);
    console.log('Database Name:', dbName);
    console.log('Admin Email:', req.body.admin_email);

    res.status(201).json({ 
      success: true,
      message: 'School registered successfully',
      schoolId,
      dbName
    });

  } catch (err) {
    console.error('\n=== REGISTRATION ERROR ===');
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    
    if (client) {
      try {
        await client.query('ROLLBACK');
        console.log('Transaction rolled back');
      } catch (rollbackErr) {
        console.error('Rollback error:', rollbackErr);
      }
    }
    if (req.file) {
      fs.unlink(req.file.path, () => {});
      console.log('Uploaded logo deleted due to error');
    }
    
    res.status(500).json({ 
      success: false,
      message: err.message || 'Registration failed',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  } finally {
    if (client) {
      client.release();
      console.log('Database connection released');
    }
    if (schoolDb) {
      await schoolDb.end();
      console.log('School database connection ended');
    }
    console.log('=== PROCESS COMPLETED ===\n');
  }
});
// Helper function to create all school tables (updated to match no 2)
async function createSchoolTables(db, dbName) {
  let client;
  try {
    client = await db.connect();
    console.log(`⏳ Creating tables in database: ${dbName}`);
    
    await client.query('BEGIN');

    // Create grade level student tables
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

    // Create sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        session_name VARCHAR(20) UNIQUE NOT NULL 
      );
    `);
    console.log('✅ Created sessions table');

    // Create terms table
    await client.query(`
      CREATE TABLE IF NOT EXISTS terms (
        id SERIAL PRIMARY KEY,
        term_name VARCHAR(20) UNIQUE NOT NULL 
      );
    `);
    console.log('✅ Created terms table');

    // Create exam tables for each class
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

    // Create teacher_subjects table
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

    // Create teacher_classes table
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
    console.error(`❌ Error creating tables in ${dbName}:`, err);
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

// Add the additional routes from no 2
router.get('/api/admin-count/all', async (req, res) => {
  try {
    const query = `
      SELECT admins.*, schools.name AS school_name 
      FROM admins
      LEFT JOIN schools ON admins.school_id = schools.id
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT id, name, email, phone, address, city, state, logo AS logoUrl
      FROM schools
      WHERE id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching school:', err);
    res.status(500).json({ message: 'Failed to fetch school details' });
  }
});

router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get school details
    const schoolQuery = 'SELECT id, name, logo FROM schools WHERE id = $1';
    const schoolResult = await client.query(schoolQuery, [id]);
    
    if (schoolResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ message: 'School not found' });
    }

    const school = schoolResult.rows[0];
    const schoolDbName = `school_${school.name.replace(/\s+/g, '_').toLowerCase()}`;

    // 2. Delete related students from students_login
    await client.query(`
      DELETE FROM students_login 
      WHERE school_name = $1
    `, [school.name]);

    // 3. Delete related teachers from teachers_login
    await client.query(`
      DELETE FROM teachers_login 
      WHERE school_name = $1
    `, [school.name]);

    // 4. Delete related admins
    await client.query('DELETE FROM admins WHERE school_id = $1', [id]);

    // 5. Delete the school
    await client.query('DELETE FROM schools WHERE id = $1', [id]);

    await client.query('COMMIT');
    client.release();

    // 6. Try to drop the school's database with a new connection
    let tempClient;
    try {
      tempClient = await pool.connect();
      await tempClient.query('DROP DATABASE IF EXISTS ' + schoolDbName);
    } catch (dbError) {
      console.error('Database drop failed:', dbError);
    } finally {
      if (tempClient) tempClient.release();
    }

    // 7. Delete logo file if exists
    if (school.logo) {
      const logoPath = path.join(__dirname, '../uploads/logos', school.logo);
      if (fs.existsSync(logoPath)) {
        fs.unlink(logoPath, (err) => {
          if (err) console.error('Logo deletion failed:', err);
        });
      }
    }

    res.json({ 
      success: true, 
      message: 'School and all related data deleted successfully',
      deleted: {
        school_id: id,
        school_name: school.name,
        database: schoolDbName
      }
    });

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }
    console.error('Delete error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete school',
      error: err.message 
    });
  } finally {
    if (client && !client.released) {
      client.release();
    }
  }
});

module.exports = router;