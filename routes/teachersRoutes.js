const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');

const router = express.Router();

// Configure directories - use absolute paths
const baseDir = path.join(__dirname, '..'); // Go up one level from current directory
const uploadDir = path.join(baseDir, 'uploads', 'imports');
const teacherPhotoDir = path.join(baseDir, 'uploads', 'teachers');

// Create directories if they don't exist (with error handling)
[uploadDir, teacherPhotoDir].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  } catch (err) {
    console.error(`Error creating directory ${dir}:`, err);
  }
});

// Storage for teacher photos with enhanced logging
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log(`Attempting to save file to: ${teacherPhotoDir}`);
    cb(null, teacherPhotoDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = 'teacher-' + uniqueSuffix + path.extname(file.originalname);
    console.log(`Generated filename: ${filename}`);
    cb(null, filename);
  }
});

const uploadPhoto = multer({ 
  storage: photoStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      console.log('Rejected file with mimetype:', file.mimetype);
      cb(new Error('Only image files are allowed'), false);
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
router.post('/add-teacher', (req, res) => {
  uploadPhoto.single('photo')(req, res, async (err) => {
    try {
      if (err) {
        console.error('Upload error:', err);
        return res.status(400).json({ 
          success: false, 
          message: err.message 
        });
      }

      console.log('Request body:', req.body);
      console.log('Uploaded file:', req.file);

      // Verify file was actually saved
      if (req.file) {
        const filePath = path.join(teacherPhotoDir, req.file.filename);
        console.log('Expected file path:', filePath);
        
        if (!fs.existsSync(filePath)) {
          console.error('File was not saved to expected location!');
          return res.status(500).json({
            success: false,
            message: 'File upload failed - file not saved'
          });
        }
      }

      const { 
        schoolName, 
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
      let centralDb = await pool.connect();
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
      let schoolDb = await getSchoolDbConnection(dbName);

      await schoolDb.query('BEGIN');

      // Generate teacher ID and password
      const teacherId = await generateTeacherId(schoolDb, school, department);
      const teacherPassword = generateRandomPassword();

      // Insert teacher record into school database
      await schoolDb.query(
        `INSERT INTO teachers 
          (teacher_id, full_name, email, phone, gender, department, photo_url)
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
  }); // This was the missing closing parenthesis and brace
});

// Add this route to your teacherImport.js or teachersRoutes.js
router.get('/', async (req, res) => {
  let schoolDb;
  try {
    const { schoolName } = req.query;
    
    if (!schoolName) {
      return res.status(400).json({
        success: false,
        message: 'School name is required'
      });
    }

    // Connect to central DB to get school info
    const centralDb = await pool.connect();
    const schoolInfo = await centralDb.query(
      'SELECT id, name FROM schools WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [schoolName]
    );

    if (schoolInfo.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'School not found'
      });
    }

    const school = schoolInfo.rows[0];
    const dbName = `school_${school.name.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName);

    // Fetch teachers from school database
    const teachers = await schoolDb.query(
      'SELECT teacher_id, full_name, email, phone, gender, department, photo_url FROM teachers'
    );

    return res.status(200).json({
      success: true,
      data: teachers.rows
    });

  } catch (err) {
    console.error('Error fetching teachers:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch teachers',
      error: err.message
    });
  } finally {
    if (schoolDb) await schoolDb.end();
  }
});


module.exports = router;