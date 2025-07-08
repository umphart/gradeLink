const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');
const { log } = require('console');

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
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });
router.post('/students', upload.single('file'), async (req, res) => {
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
    let students = [];

    if (fileExt === '.csv') {
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => students.push(row))
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      students = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (students.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: 'No student data found in the file',
      });
    }

    const requiredFields = ['full_name', 'class_name', 'gender', 'section'];
    const validSections = ['primary', 'junior', 'senior'];
    const errors = [];
    const successfullyImported = [];

    await schoolDb.query('BEGIN');
    await centralDb.query('BEGIN');

    // Helper function to generate random password
    const generateRandomPassword = (length = 6) => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      let password = '';
      for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return password;
    };

    // Function to generate student ID (same as in /add-student)
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

    try {
      for (const [index, student] of students.entries()) {
        const rowNumber = index + 2; // +2 because header is row 1 and arrays are 0-based
        
        // Validate required fields
        const missingFields = requiredFields.filter(field => !student[field]);
        if (missingFields.length > 0) {
          errors.push(`Row ${rowNumber}: Missing required fields - ${missingFields.join(', ')}`);
          continue;
        }

        const section = student.section.toLowerCase();
        if (!validSections.includes(section)) {
          errors.push(`Row ${rowNumber}: Invalid section '${student.section}'. Must be Primary, Junior, or Senior`);
          continue;
        }

        // Generate admission number
        const prefix = school.name.split(' ').map(w => w.charAt(0)).join('').toUpperCase();
        const sectionCodes = { primary: 'PR', junior: 'JS', senior: 'SS' };
        const currentYear = new Date().getFullYear();
        const studentTableName = `${section}_students`;

        const countResult = await schoolDb.query(`SELECT COUNT(*) FROM ${studentTableName}`);
        const count = parseInt(countResult.rows[0].count || '0') + 1;
        const admissionNumber = `${prefix}/${sectionCodes[section]}/${currentYear}/${String(count).padStart(3, '0')}`;

        // Generate student ID
        const studentId = generateStudentId(student.full_name, admissionNumber);
        
        // Generate password for the student
        const studentPassword = generateRandomPassword();

        try {
          // Insert student record (now with studentId)
          await schoolDb.query(
            `INSERT INTO ${studentTableName} 
              (full_name, admission_number, studentId, class_name, section, gender, age, guidance_name, guidance_contact, disability_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              student.full_name.trim(),
              admissionNumber,
              studentId, // Added studentId here
              student.class_name,
              section,
              student.gender,
              student.age || null,
              student.guidance_name || null,
              student.guidance_contact || null,
              student.disability_status || null,
            ]
          );

          // Insert into central students_login table (now with studentId)
          await centralDb.query(
            `INSERT INTO students_login (admission_number, studentId, password, school_db_name, school_name, logo)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              admissionNumber,
              studentId, // Added studentId here
              studentPassword,
              dbName,
              school.name,
              school.logo
            ]
          );

          successfullyImported.push({
            name: student.full_name,
            admissionNumber,
            studentId,
            class: student.class_name,
            section,
            password: studentPassword,
            logo: school.logo
          });
        } catch (err) {
          if (err.code === '23505') { // Unique violation
            errors.push(`Row ${rowNumber}: Student with similar details already exists`);
          } else {
            errors.push(`Row ${rowNumber}: Database error - ${err.message}`);
          }
        }
      }

      await schoolDb.query('COMMIT');
      await centralDb.query('COMMIT');
      fs.unlinkSync(filePath);

      return res.status(200).json({
        success: true,
        message: `Imported ${successfullyImported.length} of ${students.length} students`,
        imported: successfullyImported,
        errors: errors.length > 0 ? errors : undefined,
      });
      
    } catch (err) {
      await schoolDb.query('ROLLBACK');
      await centralDb.query('ROLLBACK');
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
      message: 'Failed to import students', 
      error: err.message,
      errors: [err.message]
    });
  } finally {
    if (schoolDb) await schoolDb.end();
    if (centralDb) centralDb.release();
  }
});
module.exports = router;