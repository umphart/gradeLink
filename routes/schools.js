const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');
const { log } = require('console');
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

router.post('/register', upload.single('school_logo'), async (req, res) => {
  console.log('Registration data:', req.body.data);
  try {
    if (!req.body.data) {
      return res.status(400).json({ message: 'Missing registration data' });
    }

    const { school, admin } = JSON.parse(req.body.data);
    const logoFile = req.file;

    const client = await pool.connect();

    // Step 1: Insert into central DB
    const schoolInsert =
      `INSERT INTO schools (name, email, phone, address, city, state, logo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;`;

    const schoolResult = await client.query(schoolInsert, [
      school.name,
      school.email,
      school.phone,
      school.address.street,
      school.address.city,
      school.address.state,
      logoFile?.filename || null,
    ]);

    const schoolId = schoolResult.rows[0].id;

    // Step 2: Create dedicated DB
    const dbName = `school_${school.name.replace(/\s+/g, '_').toLowerCase()}`;
    const createDbQuery = `CREATE DATABASE ${dbName};`;

    try {
      await client.query('COMMIT'); // Ensure not in transaction block
      await pool.query(createDbQuery);
      console.log(`✅ Database created: ${dbName}`);
    } catch (error) {
      console.error(`❌ Failed to create database ${dbName}:`, error);
      return res.status(500).json({ message: 'Database creation failed' });
    }

try {
  const schoolDb = getSchoolDbConnection(dbName);

  // Step 3a: Create student tables
  const gradeLevels = ['primary', 'junior', 'senior'];
  for (const grade of gradeLevels) {
    const createTableQuery = `
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
    `;
    await schoolDb.query(createTableQuery);
    console.log(`✅ ${grade}_students table created in DB: ${dbName}`);
  }

  // Step 3b: Create exam tables for each class 
const allClasses = [
  'primary1', 'primary2', 'primary3', 'primary4', 'primary5',
  'jss1', 'jss2', 'jss3',
  'ss1', 'ss2', 'ss3'
];

// Create sessions table
const createSessionsTable = `
  CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    session_name VARCHAR(20) UNIQUE NOT NULL 
  );
`;
await schoolDb.query(createSessionsTable);
console.log(`✅ sessions table created in DB: ${dbName}`);

// Create terms table
const createTermsTable = `
  CREATE TABLE IF NOT EXISTS terms (
    id SERIAL PRIMARY KEY,
    term_name VARCHAR(20) UNIQUE NOT NULL 
  );
`;
await schoolDb.query(createTermsTable);
console.log(`✅ terms table created in DB: ${dbName}`);

for (const className of allClasses) {
  const createExamTableQuery = `
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
  `;
  await schoolDb.query(createExamTableQuery);
  console.log(`✅ ${className}_exam table created in DB: ${dbName}`);
}

  // Step 3c: Create teachers table
  const createTeachersTable = `
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
  `;
await schoolDb.query(createTeachersTable);
console.log(`✅ teachers table created in DB: ${dbName}`);

// Step 3d: Create subjects table
const createSubjectsTable = `
  CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    subject_name VARCHAR(255) NOT NULL,
    description TEXT,
    classname VARCHAR(100), 
    subject_code VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;
await schoolDb.query(createSubjectsTable);
console.log(`✅ subjects table created in DB: ${dbName}`);

// Step 3e: Create teachers subjects table
const createTeacherSubjectTable = `
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
`;

await schoolDb.query(createTeacherSubjectTable);
console.log(`✅ Teachers subjects table created in DB: ${dbName}`);

const createTeacherClassTable = `
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
`;

await schoolDb.query(createTeacherClassTable);
console.log(`✅ Teacher classes table recreated in DB: ${dbName}`);


  await schoolDb.end();
} catch (err) {
  console.error(`❌ Failed to create student, exam, teachers_table or teacher tables in ${dbName}:`, err);
  return res.status(500).json({ message: 'Failed to initialize school database' });
}


    // Step 4: Insert admin (login remains in central DB)
    await client.query('BEGIN');
    const adminInsert =
      `INSERT INTO admins (first_name, last_name, email, phone, password, school_id)
      VALUES ($1, $2, $3, $4, $5, $6);`;
    await client.query(adminInsert, [
      admin.firstName,
      admin.lastName,
      admin.email,
      admin.phone,
      admin.password,
      schoolId,     
    ]);
    await client.query('COMMIT');
    client.release();

    res.status(201).json({ message: 'School registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Registration failed' });
  }
});
// Get all admins with school information
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

// Add this route to schools.js before the module.exports
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
// Add this route before module.exports
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
    client.release(); // Release the client before attempting to drop the database

    // 6. Try to drop the school's database with a new connection
    let tempClient;
    try {
      tempClient = await pool.connect();
      await tempClient.query('DROP DATABASE IF EXISTS ' + schoolDbName);
    } catch (dbError) {
      console.error('Database drop failed:', dbError);
      // Continue even if database deletion fails
    } finally {
      if (tempClient) tempClient.release();
    }

    // 7. Delete logo file if exists
    if (school.logo) {
      const fs = require('fs');
      const path = require('path');
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