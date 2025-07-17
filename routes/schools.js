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
router.post('/register', upload.single('school_logo'), async (req, res) => {
  let client;
  let schoolDb;
  
  // Enhanced registration logging
  console.log('\n══════════════════════════════════════════════════');
  console.log('🏫  NEW SCHOOL REGISTRATION PROCESS STARTED  🏫');
  console.log('══════════════════════════════════════════════════');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🌐 IP Address:', req.ip);
  console.log('📦 Request Body:', JSON.stringify(req.body, null, 2));

  // Detailed file logging
  if (req.file) {
    console.log('\n📸 SCHOOL LOGO UPLOAD DETAILS:');
    console.log('----------------------------------------');
    console.log('🖼️  Original Name:', req.file.originalname);
    console.log('📁 Stored Path:', req.file.path);
    console.log('📏 Size:', `${(req.file.size / 1024).toFixed(2)} KB`);
    console.log('🖥️  MIME Type:', req.file.mimetype);
    console.log('📝 Database Filename:', req.file.filename);
    
    // File system verification
    try {
      const stats = fs.statSync(req.file.path);
      console.log('✅ File Verification:', {
        'Created At': stats.birthtime,
        'Last Modified': stats.mtime,
        'File Size (bytes)': stats.size
      });
    } catch (err) {
      console.error('❌ File Verification Failed:', err.message);
    }
  } else {
    console.log('\n⚠️  No school logo was uploaded');
  }

  try {
    // Validation with improved field checking
    const requiredFields = {
      school_name: 'School Name',
      school_email: 'School Email', 
      school_phone: 'School Phone',
      school_address: 'School Address',
      school_city: 'School City',
      school_state: 'School State',
      admin_firstName: 'Admin First Name',
      admin_lastName: 'Admin Last Name',
      admin_email: 'Admin Email',
      admin_phone: 'Admin Phone',
      admin_password: 'Admin Password'
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([field]) => !req.body[field])
      .map(([_, name]) => name);

    if (missingFields.length > 0) {
      console.error('\n❌ MISSING REQUIRED FIELDS:', missingFields.join(', '));
      if (req.file) {
        fs.unlink(req.file.path, () => console.log('🗑️  Uploaded logo deleted'));
      }
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields',
        missingFields: missingFields,
        timestamp: new Date().toISOString()
      });
    }

    // Enhanced school data logging
    console.log('\n🏫 SCHOOL INFORMATION:');
    console.log('----------------------------------------');
    console.log('🏛️  Name:', req.body.school_name);
    console.log('📧 Email:', req.body.school_email);
    console.log('📞 Phone:', req.body.school_phone);
    console.log('📍 Address:', `${req.body.school_address}, ${req.body.school_city}, ${req.body.school_state}`);
    console.log('🖼️  Logo:', req.file?.filename || 'None');

    // Admin data logging (secure)
    console.log('\n👨‍💼 ADMIN INFORMATION:');
    console.log('----------------------------------------');
    console.log('👤 Name:', `${req.body.admin_firstName} ${req.body.admin_lastName}`);
    console.log('📧 Email:', req.body.admin_email);
    console.log('📞 Phone:', req.body.admin_phone);
    console.log('🔒 Password:', '••••••••');
    console.log('🔄 Password Hash:', bcrypt.hashSync(req.body.admin_password, 10).slice(0, 20) + '...');

    // Database operations
    client = await pool.connect();
    await client.query('BEGIN');

    console.log('\n💾 DATABASE OPERATIONS:');
    console.log('----------------------------------------');
    
    // 1. Insert school into central DB
    const schoolInsert = `
      INSERT INTO schools (name, email, phone, address, city, state, logo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, created_at;
    `;

    console.log('📥 Inserting school into central database...');
    const schoolResult = await client.query(schoolInsert, [
      req.body.school_name.trim(),
      req.body.school_email.toLowerCase().trim(),
      req.body.school_phone.trim(),
      req.body.school_address.trim(),
      req.body.school_city.trim(),
      req.body.school_state.trim(),
      req.file?.filename || null,
    ]);

    const school = schoolResult.rows[0];
    console.log('✅ School created:', {
      id: school.id,
      name: school.name,
      created_at: school.created_at
    });

    // 2. Create dedicated database
    const dbName = `school_${req.body.school_name.replace(/\s+/g, '_').toLowerCase()}`;
    console.log('\n🛠 Creating dedicated database:', dbName);
    
    try {
      await client.query('COMMIT');
      await pool.query(`CREATE DATABASE ${dbName}`);
      
      // Verify database
      const dbCheck = await pool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`, 
        [dbName]
      );
      if (dbCheck.rows.length === 0) throw new Error('Database verification failed');
      
      console.log(`✅ Database "${dbName}" created successfully`);
    } catch (error) {
      console.error(`❌ Database creation failed:`, error.message);
      throw new Error(`Database creation failed: ${error.message}`);
    }

    // 3. Initialize school database tables
    try {
      console.log(`\n🛠 Initializing tables in ${dbName}`);
      schoolDb = getSchoolDbConnection(dbName);
      
      // Test connection
      const testClient = await schoolDb.connect();
      const testRes = await testClient.query('SELECT NOW() AS db_time');
      console.log('⏱️  Database time:', testRes.rows[0].db_time);
      testClient.release();

      await createSchoolTables(schoolDb, dbName);
      
      // Verify tables
      const verifyClient = await schoolDb.connect();
      const { rows: tables } = await verifyClient.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      console.log('📊 Tables created:', tables.map(t => t.table_name).join(', '));
      verifyClient.release();
    } catch (err) {
      console.error(`❌ Database initialization failed:`, err.message);
      throw new Error(`Database initialization failed: ${err.message}`);
    }

    // 4. Create admin account
    console.log('\n👨‍💼 Creating admin account...');
    client = await pool.connect();
    await client.query('BEGIN');
    
    const hashedPassword = await bcrypt.hash(req.body.admin_password, 12);
    const adminResult = await client.query(
      `INSERT INTO admins (first_name, last_name, email, phone, password, school_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        req.body.admin_firstName.trim(),
        req.body.admin_lastName.trim(),
        req.body.admin_email.toLowerCase().trim(),
        req.body.admin_phone.trim(),
        hashedPassword,
        school.id
      ]
    );
    
    await client.query('COMMIT');
    const admin = adminResult.rows[0];
    console.log('✅ Admin account created:', {
      id: admin.id,
      email: req.body.admin_email,
      created_at: admin.created_at
    });

    // Successful response
    console.log('\n🎉 REGISTRATION COMPLETE 🎉');
    console.log('----------------------------------------');
    console.log('🏫 School ID:', school.id);
    console.log('💾 Database:', dbName);
    console.log('👨‍💼 Admin ID:', admin.id);
    if (req.file) {
      console.log('🖼️  Logo URL:', `/uploads/logos/${req.file.filename}`);
    }

    res.status(201).json({ 
      success: true,
      message: 'School registered successfully',
      data: {
        school: {
          id: school.id,
          name: school.name,
          dbName: dbName,
          logo: req.file ? `/uploads/logos/${req.file.filename}` : null,
          created_at: school.created_at
        },
        admin: {
          id: admin.id,
          email: req.body.admin_email,
          created_at: admin.created_at
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('\n❌❌❌ REGISTRATION FAILED ❌❌❌');
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    
    if (client) {
      try {
        await client.query('ROLLBACK');
        console.log('↩️  Transaction rolled back');
      } catch (rollbackErr) {
        console.error('❌ Rollback failed:', rollbackErr.message);
      }
    }
    if (req.file) {
      fs.unlink(req.file.path, () => console.log('🗑️  Uploaded logo deleted'));
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Registration failed: ' + err.message,
      error: process.env.NODE_ENV === 'development' ? {
        message: err.message,
        stack: err.stack
      } : undefined,
      timestamp: new Date().toISOString()
    });
  } finally {
    if (client) {
      client.release();
      console.log('🔌 Database connection released');
    }
    if (schoolDb) {
      await schoolDb.end();
      console.log('🔌 School database connection ended');
    }
    console.log('══════════════════════════════════════════════════\n');
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