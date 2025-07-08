const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Add teacher route
router.post('/add', upload.single('photo'), async (req, res) => {
  let schoolDb;
  try {
    // Validate required fields
    if (!req.body.schoolName || !req.body.full_name || !req.body.department) {
      return res.status(400).json({ 
        success: false,
        error: 'schoolName, full_name, and department are required fields' 
      });
    }

    const {
      schoolName,
      full_name,
      email,
      phone,
      gender,
      department
    } = req.body;

    // Trim and validate inputs
    const trimmedSchoolName = schoolName.toString().trim();
    const trimmedFullName = full_name.toString().trim();
    const trimmedDepartment = department.toString().trim();

    if (!trimmedSchoolName || !trimmedFullName || !trimmedDepartment) {
      return res.status(400).json({ 
        success: false,
        error: 'Required fields cannot be empty' 
      });
    }

    // Check if school exists
    const schoolResult = await pool.query(
      `SELECT id, logo FROM schools WHERE name = $1`,
      [trimmedSchoolName]
    );
    if (schoolResult.rowCount === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'School not found' 
      });
    }

    const { logo: schoolLogo } = schoolResult.rows[0];

    // Prepare school database connection
    const schoolDbName = `school_${trimmedSchoolName.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(schoolDbName);

    // Generate teacher ID
    const schoolPrefix = trimmedSchoolName
      .split(' ')
      .map(w => w.charAt(0).toUpperCase())
      .join('')
      .slice(0, 3);
    const depPrefix = trimmedDepartment.toUpperCase().slice(0, 3);
    const currentYear = new Date().getFullYear();

    const countResult = await schoolDb.query(
      'SELECT COUNT(*) FROM teachers WHERE department = $1',
      [trimmedDepartment]
    );
    const count = parseInt(countResult.rows[0].count || '0') + 1;
    const serial = String(count).padStart(3, '0');

    const teacher_id = `${schoolPrefix}/${depPrefix}/${currentYear}/${serial}`;
    const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email format' 
      });
    }

    // Start transaction
    await schoolDb.query('BEGIN');

    // Insert into school-specific teachers table
    await schoolDb.query(
      `INSERT INTO teachers (teacher_id, teacher_name, email, phone, gender, department, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        teacher_id,
        trimmedFullName,
        email ? email.trim() : null,
        phone ? phone.trim() : null,
        gender,
        trimmedDepartment,
        photo_url
      ]
    );

    function generateRandomPassword(length = 4) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let password = '';
      for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return password;
    }

    const teacherPassword = generateRandomPassword();
    console.log(`Generated password for ${teacher_id}: ${teacherPassword}`);

    await pool.query(
      `INSERT INTO teachers_login (teacher_id, password, school_db_name, school_name, logo)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        teacher_id,
        teacherPassword,
        schoolDbName,
        trimmedSchoolName,
        schoolLogo
      ]
    );

    // Respond to frontend with generated password
    return res.status(201).json({
      success: true,
      message: 'Teacher added successfully',
      teacher_id,
      password: teacherPassword
    });
  } catch (err) {
    // Rollback transaction if any error occurs
    if (schoolDb) {
      await schoolDb.query('ROLLBACK').catch(rollbackErr => {
        console.error('Error rolling back transaction:', rollbackErr);
      });
    }

    console.error('Error adding teacher:', err);

    // Clean up uploaded file if an error occurred
    if (req.file) {
      fs.unlink(path.join(uploadDir, req.file.filename), () => {});
    }

    const errorMessage = err.code === '23505' 
      ? 'Teacher with these details already exists' 
      : 'Failed to add teacher';

    return res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    // Release the school database connection
    if (schoolDb) {
      schoolDb.release();
    }
  }
});

// Get all teachers for a specific school
router.get('/', async (req, res) => {
  const { schoolName } = req.query;
  let schoolDb;

  try {
    if (!schoolName) {
      return res.status(400).json({ error: 'schoolName is required' });
    }

    const trimmedSchoolName = schoolName.toString().trim();
    const schoolDbName = `school_${trimmedSchoolName.replace(/\s+/g, '_').toLowerCase()}`;

    schoolDb = await getSchoolDbConnection(schoolDbName);

    const result = await schoolDb.query('SELECT * FROM teachers ORDER BY teacher_name ASC');

    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  } 
});

// GET a specific teacher by ID
router.get('/:id', async (req, res) => {
  try {
    const { schoolName } = req.query;
    const { id } = req.params;

    if (!schoolName) {
      return res.status(400).json({ success: false, error: 'schoolName is required' });
    }

    const schoolDbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    const schoolDb = await getSchoolDbConnection(schoolDbName);

    const result = await schoolDb.query('SELECT * FROM teachers WHERE teacher_id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    return res.json({ success: true, teacher: result.rows[0] });
  } catch (error) {
    console.error('Error fetching teacher:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch teacher' });
  }
});

router.post('/assign-class', async (req, res) => {
  const { schoolName, teacher_id, className, section } = req.body;

  if (!schoolName || !teacher_id || !className || !section) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    // Get teacher details using teacher_id (not UUID)
    const teacherQuery = await schoolDb.query(
      'SELECT teacher_name, teacher_id FROM teachers WHERE teacher_id = $1',
      [teacher_id]
    );

    if (teacherQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const { teacher_name, teacher_id: teacherDbId } = teacherQuery.rows[0];

    const insertQuery = `
      INSERT INTO teacher_classes (
        teacher_id, teacher_name, teacher_code, class_name, section
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (class_name, section) DO UPDATE
      SET teacher_id = $1, teacher_name = $2, teacher_code = $3, assigned_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await schoolDb.query(insertQuery, [
      teacherDbId,    // Use the renamed variable
      teacher_name,
      teacherDbId,    // Use the renamed variable
      className,
      section
    ]);

    res.status(201).json({ 
      message: 'Class assigned to teacher successfully', 
      assignment: result.rows[0] 
    });
  } catch (err) {
    console.error('Error assigning class to teacher:', err);
    res.status(500).json({ message: 'Failed to assign class', error: err.message });
  }
});

module.exports = router;