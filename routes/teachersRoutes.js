const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');

const router = express.Router();

// Configure directories
const uploadDir = path.join(__dirname, '../uploads/imports');
const teacherPhotoDir = path.join(__dirname, '../uploads/teachers');

// Create directories if they don't exist
[uploadDir, teacherPhotoDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Storage for bulk imports
const importStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'teachers-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Storage for teacher photos
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, teacherPhotoDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'teacher-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure upload for bulk imports
const uploadImport = multer({ 
  storage: importStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Configure upload for teacher photos
const uploadPhoto = multer({ 
  storage: photoStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  }
});

// Helper function to generate random password
function generateRandomPassword(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Helper function to generate teacher ID
async function generateTeacherId(schoolDb, school, department) {
  const schoolPrefix = school.name
    .split(' ')
    .map(w => w.charAt(0).toUpperCase())
    .join('')
    .slice(0, 3);

  const currentYear = new Date().getFullYear();
  const depPrefix = department.toUpperCase().slice(0, 3);
  
  const countResult = await schoolDb.query(
    'SELECT COUNT(*) FROM teachers WHERE department = $1',
    [department]
  );
  const count = parseInt(countResult.rows[0].count || '0') + 1;
  const serial = String(count).padStart(3, '0');
  
  return `${schoolPrefix}/${depPrefix}/${currentYear}/${serial}`;
}

// Route to add a single teacher with photo upload
router.post('/add-teacher', uploadPhoto.single('photo'), async (req, res) => {
  let schoolDb;
  let centralDb;

  try {
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);

    const { 
      schoolName, 
      schoolId,
      full_name, 
      department, 
      email, 
      phone, 
      gender 
    } = req.body;
    
    // Validate required fields
    if (!schoolName || !full_name || !department) {
      // Clean up uploaded file if validation fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'School name, full name, and department are required',
      });
    }

    // Connect to central DB and fetch school info
    centralDb = await pool.connect();
    const schoolInfo = await centralDb.query(
      'SELECT id, name, logo FROM schools WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [schoolName]
    );

    if (schoolInfo.rows.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'School not found',
      });
    }

    const school = schoolInfo.rows[0];
    const dbName = `school_${school.name.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName);

    await schoolDb.query('BEGIN');

    // Generate teacher ID and password
    const teacherId = await generateTeacherId(schoolDb, school, department);
    const teacherPassword = generateRandomPassword();

    // Insert teacher record into school database
    await schoolDb.query(
      `INSERT INTO teachers 
        (teacher_id, full_name, email, phone, gender, department, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        teacherId, 
        full_name.trim(), 
        email?.trim(), 
        phone?.trim(), 
        gender?.trim(), 
        department.trim(),
        req.file ? `/uploads/teachers/${req.file.filename}` : null
      ]
    );

    // Insert into central teachers_login table
    await centralDb.query(
      `INSERT INTO teachers_login (teacher_id, password, school_db_name, school_name, logo)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        teacherId,
        teacherPassword, 
        dbName,
        school.name,
        school.logo
      ]
    );

    await schoolDb.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Teacher added successfully',
      teacher: {
        teacherId,
        name: full_name,
        department,
        email,
        phone,
        gender,
        photo: req.file ? `/uploads/teachers/${req.file.filename}` : null,
        password: teacherPassword
      }
    });

  } catch (err) {
    if (schoolDb) await schoolDb.query('ROLLBACK');
    // Clean up uploaded file if error occurs
    if (req.file) fs.unlinkSync(req.file.path);
    
    console.error('Add teacher error:', err);
    
    if (err.code === '23505') { // Unique violation
      return res.status(409).json({ 
        success: false, 
        message: 'Teacher with similar details already exists'
      });
    }

    return res.status(500).json({ 
      success: false, 
      message: 'Failed to add teacher', 
      error: err.message
    });
  } finally {
    if (schoolDb) await schoolDb.end();
    if (centralDb) centralDb.release();
  }
});



module.exports = router;