//student.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const {
  getGrade,
  getRemark,
  updateAveragesAndPositions
} = require('./../utils/examUtils'); 

const { log, timeLog } = require('console');

const router = express.Router();


// Create uploads directory if not exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'));
  }
});

// Main route

router.post('/add-student', upload.single('photo'), async (req, res) => {
  let schoolDb;
  let centralDb;
  
  try {
    const { schoolName, section, student } = req.body;
    const normalizedSection = section.toLowerCase();
    const parsedStudent = JSON.parse(student);

    // Validation checks
    if (!schoolName || !section || !parsedStudent.full_name || !parsedStudent.class_name || !parsedStudent.gender) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const validSections = ['primary', 'junior', 'senior'];
    if (!validSections.includes(normalizedSection)) {
      return res.status(400).json({ message: 'Invalid section' });
    }

    const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    
    // Connect to both databases
    schoolDb = await getSchoolDbConnection(dbName);
    centralDb = await pool.connect();
    
    // Generate admission number
    const getPrefixFromSchoolName = (name) =>
      name.split(' ').map(w => w.charAt(0)).join('').toUpperCase();

    const sectionCodes = { primary: 'PR', junior: 'JS', senior: 'SS' };
    const prefix = getPrefixFromSchoolName(schoolName);
    const sectionCode = sectionCodes[normalizedSection];
    const currentYear = new Date().getFullYear();

    const studentTableName = `${normalizedSection}_students`;
    const countResult = await schoolDb.query(`SELECT COUNT(*) FROM ${studentTableName}`);
    const count = parseInt(countResult.rows[0].count, 10) + 1;
    const admissionNumber = `${prefix}/${sectionCode}/${currentYear}/${String(count).padStart(3, '0')}`;

    // Function to generate student ID
    function generateStudentId(fullName, admissionNumber) {
      const nameParts = fullName.trim().split(/\s+/);
      const firstInitial = nameParts[0]?.charAt(0).toLowerCase() || '';
      const lastInitial = nameParts.length > 1 ? nameParts[nameParts.length - 1]?.charAt(0).toLowerCase() : '';
      const middleInitial = nameParts.length > 2 ? nameParts[1]?.charAt(0).toLowerCase() : '';
      
      const admissionParts = admissionNumber.split('/');
      const year = admissionParts.length >= 3 ? admissionParts[2].slice(-2) : '';
      const schoolPrefix = admissionParts[0]?.toLowerCase() || '';
      
      return `${firstInitial}${middleInitial}${lastInitial}${year}.${schoolPrefix}@edu.ng`;
    }

    const studentId = generateStudentId(parsedStudent.full_name, admissionNumber);
    console.log(`Generated student ID: ${studentId}`);

    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Generate random password
    function generateRandomPassword(length = 4) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let password = '';
      for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return password;
    }

    const studentPassword = generateRandomPassword();

    // Start transactions
    await schoolDb.query('BEGIN');
    await centralDb.query('BEGIN');

    try {
      const schoolInfo = await centralDb.query(
        'SELECT logo FROM schools WHERE name = $1',
        [schoolName.trim()]
      );
      const schoolLogo = schoolInfo.rows[0]?.logo || null;

      // Insert into school-specific student table (now with studentId)
      await schoolDb.query(
        `INSERT INTO ${studentTableName} 
         (full_name, admission_number, studentId, class_name, section, gender, age, guidance_name, guidance_contact, photo_url, disability_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          parsedStudent.full_name.trim(),
          admissionNumber,
          studentId, // Added studentId here
          parsedStudent.class_name,
          normalizedSection,
          parsedStudent.gender,
          parsedStudent.age || null,
          parsedStudent.guidance_name || null,
          parsedStudent.guidance_contact || null,
          photoUrl,
          parsedStudent.disability_status || null
        ]
      );

      // Insert into central students_login table with studentId
      await centralDb.query(
        `INSERT INTO students_login (admission_number, studentId, password, school_db_name, school_name, logo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          admissionNumber,
          studentId,
          studentPassword,
          dbName,
          schoolName.trim(),
          schoolLogo
        ]
      );

      // Commit both transactions
      await schoolDb.query('COMMIT');
      await centralDb.query('COMMIT');

      return res.status(201).json({
        success: true,
        message: 'Student added successfully',
        admissionNumber,
        studentId,
        password: studentPassword,
        student: {
          ...parsedStudent,
          admissionNumber,
          studentId,
          section: normalizedSection,
          photoUrl
        }
      });

    } catch (err) {
      // Rollback both transactions if any error occurs
      await schoolDb.query('ROLLBACK');
      await centralDb.query('ROLLBACK');
      console.error('Transaction error:', err);
      throw err;
    }
  } catch (err) {
    console.error('Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ 
        success: false, 
        message: 'Internal server error', 
        error: err.message 
      });
    }
  } finally {
    // Ensure connections are always released
    if (schoolDb) await schoolDb.end();
    if (centralDb) centralDb.release();
  }
});

router.get('/students', async (req, res) => {
  try {
    const { schoolName } = req.query;

    if (!schoolName) {
      return res.status(400).json({ message: 'Missing schoolName in query parameters' });
    }

    const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    let schoolDb;

    try {
      schoolDb = await getSchoolDbConnection(dbName);
      await schoolDb.query('SELECT 1');
    } catch (dbErr) {
      console.error(`Failed to connect to school database ${dbName}:`, dbErr);
      return res.status(500).json({
        message: 'Failed to connect to school database',
        error: dbErr.message
      });
    }

    const sections = ['primary', 'junior', 'senior'];
    const students = {};
for (const section of sections) {
  const tableName = `${section}_students`;
  try {
    const result = await schoolDb.query(`SELECT * FROM ${tableName};`);
    students[section] = result.rows;
;

  } catch (err) {
    console.warn(`Warning: Could not fetch students from ${tableName}. It may not exist.`, err.message);
    students[section] = [];
  }
}

    await schoolDb.end();
    res.status(200).json({
      success: true,
      students
    });
 //  console.log(students);
  
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  }
});

module.exports = router;
