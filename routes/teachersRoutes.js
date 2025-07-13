// routes/teacherImport.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');

const router = express.Router();

// Configure file upload
const uploadDir = path.join(__dirname, '../uploads/imports');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'teachers-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
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

// Route to add a single teacher
router.post('/add-teacher', async (req, res) => {
  let schoolDb;
  let centralDb;

  try {
    const { schoolName, fullName, department, email, phone, gender } = req.body;
    
    if (!schoolName || !fullName || !department) {
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
        (teacher_id, teacher_name, email, phone, gender, department)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [teacherId, fullName.trim(), email?.trim(), phone?.trim(), gender?.trim(), department.trim()]
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
        name: fullName,
        department,
        email,
        phone,
        gender,
        password: teacherPassword // Include password in the response
      }
    });

  } catch (err) {
    if (schoolDb) await schoolDb.query('ROLLBACK');
    
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

// Existing import teachers route
router.post('/import-teachers', upload.single('file'), async (req, res) => {
  let schoolDb;
  let centralDb;

  try {
    const { schoolName } = req.body;
    if (!schoolName || !req.file) {
      return res.status(400).json({
        success: false,
        message: 'School name and file are required',
      });
    }

    // Connect to central DB and fetch school info
    centralDb = await pool.connect();
    const schoolInfo = await centralDb.query(
      'SELECT id, name, logo FROM schools WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [schoolName]
    );

    if (schoolInfo.rows.length === 0) {
      // Clean up uploaded file
      if (req.file) fs.unlinkSync(req.file.path);
      
      return res.status(404).json({
        success: false,
        message: 'School not found',
      });
    }

    const school = schoolInfo.rows[0];
    const dbName = `school_${school.name.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName);

    // Process uploaded file
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let teachers = [];

    if (fileExt === '.csv') {
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => teachers.push(row))
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      teachers = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (teachers.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: 'No teacher data found in the file',
      });
    }

    const requiredFields = ['full_name', 'department'];
    const errors = [];
    const successfullyImported = [];

    await schoolDb.query('BEGIN');

    try {
      for (const [index, teacher] of teachers.entries()) {
        const rowNumber = index + 2; // +2 because header is row 1 and arrays are 0-based
        
        // Validate required fields
        const missingFields = requiredFields.filter(field => !teacher[field]);
        if (missingFields.length > 0) {
          errors.push(`Row ${rowNumber}: Missing required fields - ${missingFields.join(', ')}`);
          continue;
        }

        // Trim and validate data
        const fullName = (teacher.full_name || '').toString().trim();
        const department = (teacher.department || '').toString().trim();
        const email = teacher.email ? teacher.email.toString().trim() : null;
        const phone = teacher.phone ? teacher.phone.toString().trim() : null;
        const gender = teacher.gender ? teacher.gender.toString().trim() : null;

        if (!fullName || !department) {
          errors.push(`Row ${rowNumber}: Name and department cannot be empty`);
          continue;
        }

        // Generate teacher ID and password
        const teacherId = await generateTeacherId(schoolDb, school, department);
        const teacherPassword = generateRandomPassword();

        try {
          // Insert teacher record
          await schoolDb.query(
            `INSERT INTO teachers 
              (teacher_id, teacher_name, email, phone, gender, department)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [teacherId, fullName, email, phone, gender, department]
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

          successfullyImported.push({
            name: fullName,
            teacherId,
            department,
            password: teacherPassword
          });
        } catch (err) {
          if (err.code === '23505') { // Unique violation
            errors.push(`Row ${rowNumber}: Teacher with similar details already exists`);
          } else {
            errors.push(`Row ${rowNumber}: Database error - ${err.message}`);
          }
        }
      }

      await schoolDb.query('COMMIT');
      fs.unlinkSync(filePath);

      return res.status(200).json({
        success: true,
        message: `Imported ${successfullyImported.length} of ${teachers.length} teachers`,
        imported: successfullyImported,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err) {
      await schoolDb.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('Import error:', err);
    
    // Clean up uploaded file if error occurred
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({ 
      success: false, 
      message: 'Failed to import teachers', 
      error: err.message,
      errors: [err.message]
    });
  } finally {
    if (schoolDb) await schoolDb.end();
    if (centralDb) centralDb.release();
  }
});

module.exports = router;    