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
  console.log('Received request to add student');
  console.log('Body:', req.body);
  console.log('File:', req.file);
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

router.get('/', async (req, res) => {
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
router.get('/api/student-count/all', async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id AS school_id,
        s.name AS school_name,
        COUNT(sl.*) AS student_count
      FROM schools s
      LEFT JOIN students_login sl ON s.db_name = sl.school_db_name
      GROUP BY s.id, s.name
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// A
router.get('/student/:admissionNumber', async (req, res) => {
  let schoolDb;
  try {
    const admissionNumber = decodeURIComponent(req.params.admissionNumber);
    
    // First get the school info from central DB
    const centralResult = await pool.query(
      'SELECT * FROM students_login WHERE admission_number = $1',
      [admissionNumber]
    );
    
    if (centralResult.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    const { school_db_name, school_name, logo } = centralResult.rows[0];
    schoolDb = await getSchoolDbConnection(school_db_name);
    
    // Check all sections for the student
    const sections = ['primary', 'junior', 'senior'];
    let student = null;
    
    for (const section of sections) {
      const tableName = `${section}_students`;
      try {
        const result = await schoolDb.query(
          `SELECT * FROM ${tableName} WHERE admission_number = $1`,
          [admissionNumber]
        );
        
        if (result.rows.length > 0) {
          student = result.rows[0];
          student.section = section;
          break;
        }
      } catch (err) {
        console.warn(`Table ${tableName} not found or error querying`, err.message);
      }
    }
    
    if (!student) {
      return res.status(404).json({ message: 'Student record not found' });
    }
    
    res.status(200).json({
      success: true,
      student: {
        ...student,
        schoolName: school_name,
        logo
      }
    });
    
  } catch (err) {
    console.error('Error fetching student:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  } finally {
    if (schoolDb) await schoolDb.end();
  }
});

router.get('/get-exam-records', async (req, res) => {
  let schoolDb;

  try {
    const { schoolName, className, admissionNumber, sessionName, termName } = req.query;

    const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

    // Enhanced class mapping
    const classToTableMap = {
      primary: 'primary_students',
      jss: 'junior_students',    // Map JSS to junior
      ss: 'senior_students',     // Map SS to senior
      junior: 'junior_students',  // Alternative mapping
      senior: 'senior_students'   // Alternative mapping
    };

    // Extract the section part from className (e.g., 'JSS 1' -> 'jss')
    const sectionKey = className.toLowerCase().split(' ')[0];
    
    const studentTable = classToTableMap[sectionKey];
    const normalizedClassName = className.toLowerCase().replace(/\s+/g, ''); // e.g., 'jss1'

    const examTable = `${normalizedClassName}_exam`;

    if (!studentTable) {
      return res.status(400).json({ 
        message: 'Invalid className provided',
        details: `Expected class to start with Primary, JSS, or SS. Received: ${className}`
      });
    }

    schoolDb = await getSchoolDbConnection(dbName);

    // Get session and term IDs
    const [sessionResult, termResult] = await Promise.all([
      schoolDb.query(`SELECT id FROM sessions WHERE session_name = $1`, [sessionName]),
      schoolDb.query(`SELECT id FROM terms WHERE term_name = $1`, [termName])
    ]);

    const sessionId = sessionResult.rows[0]?.id;
    const termId = termResult.rows[0]?.id;

    if (!sessionId || !termId) {
      return res.status(404).json({ 
        message: 'Session or term not found',
        details: {
          session: sessionName,
          term: termName
        }
      });
    }

    // Check if exam table exists
    const examTableExists = await schoolDb.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_name = $1
       )`,
      [examTable]
    );

    if (!examTableExists.rows[0].exists) {
      return res.status(404).json({ 
        message: 'Exam records not found',
        details: `Exam table ${examTable} does not exist`
      });
    }

    // Log all records when page loads (when no admissionNumber specified)
    let query, params;

    if (admissionNumber) {
      query = `
        SELECT 
          e.*, 
          s.full_name AS student_name, 
          s.photo_url AS student_photo
        FROM "${examTable}" e
        JOIN "${studentTable}" s ON e.admission_number = s.admission_number
        WHERE e.admission_number = $1 AND e.session_id = $2 AND e.term_id = $3
        ORDER BY e.subject
      `;
      params = [admissionNumber, sessionId, termId];
    } else {
      query = `
        SELECT 
          e.*, 
          s.full_name AS student_name, 
          s.photo_url AS student_photo
        FROM "${examTable}" e
        JOIN "${studentTable}" s ON e.admission_number = s.admission_number
        WHERE e.session_id = $1 AND e.term_id = $2
        ORDER BY e.admission_number, e.subject
      `;
      params = [sessionId, termId];
    }

    const result = await schoolDb.query(query, params);
    

    

    res.status(200).json({
      success: true,
      examRecords: result.rows,
      metadata: {
        studentTable,
        examTable,
        recordCount: result.rows.length
      }
    });

  } catch (error) {
    console.error('Error in /get-exam-records:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch exam records',
      error: error.message,
      stack: error.stack
    });
 
  } finally {
    if (schoolDb) await schoolDb.end();
  }
});
router.get('/all-exam-records', async (req, res) => {
  let schoolDb;
  try {
    const { schoolName } = req.query;
    
    if (!schoolName) {
      return res.status(400).json({ message: 'schoolName parameter is required' });
    }

    const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName);

    // 1. Get all exam tables in the database
    const tablesResult = await schoolDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%\\_exam' ESCAPE '\\'
    `);

    if (tablesResult.rows.length === 0) {
      return res.status(404).json({ message: 'No exam tables found' });
    }

    // 2. Query each exam table
    const allRecords = [];
    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      const records = await schoolDb.query(`SELECT * FROM "${tableName}"`);
      allRecords.push({
        className: tableName.replace('_exam', ''),
        records: records.rows
      });
    }

    res.status(200).json({ 
      success: true, 
      data: allRecords 
    });

  } catch (err) {
    console.error('Error fetching exam records:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (schoolDb) await schoolDb.end();
  }
});
router.post('/add-exam-score', async (req, res) => {
  let schoolDb;
  try {
    const { schoolName, className, examData, sessionName, termName } = req.body;

    // Basic validation
    if (
      !schoolName || !className || !sessionName || !termName ||
      !examData || !Array.isArray(examData)
    ) {
      return res.status(400).json({ message: 'Missing or invalid parameters' });
    }

    // Normalize school DB name
    const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName);

    const normalizedClassName = className.toLowerCase().replace(/\s+/g, '');
    const examTable = `${normalizedClassName}_exam`;

    // Ensure session exists and get ID
    const sessionResult = await schoolDb.query(
      `SELECT id FROM sessions WHERE session_name = $1`,
      [sessionName]
    );
    let sessionId = sessionResult.rows[0]?.id;
    if (!sessionId) {
      const inserted = await schoolDb.query(
        `INSERT INTO sessions (session_name) VALUES ($1) RETURNING id`,
        [sessionName]
      );
      sessionId = inserted.rows[0].id;
    }

    // Ensure term exists and get ID
    const termResult = await schoolDb.query(
      `SELECT id FROM terms WHERE term_name = $1`,
      [termName]
    );
    let termId = termResult.rows[0]?.id;
    if (!termId) {
      const inserted = await schoolDb.query(
        `INSERT INTO terms (term_name) VALUES ($1) RETURNING id`,
        [termName]
      );
      termId = inserted.rows[0].id;
    }

    // Insert each exam record
    for (const record of examData) {
      const { student_name, admission_number, subject, exam_mark, ca } = record;
      const total = exam_mark + ca;
      const grade = getGrade(total);   // Custom function for grade logic
      const remark = getRemark(grade); // Custom function for remark logic

      await schoolDb.query(
        `INSERT INTO "${examTable}" 
          (school_id, student_name, admission_number, class_name, subject, exam_mark, ca, total, remark, session_id, term_id)
         VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [1, student_name, admission_number, className, subject, exam_mark, ca, total, remark, sessionId, termId]
      );
    }

    // Optional: Update averages and positions
    await updateAveragesAndPositions(schoolDb, examTable);

    res.status(201).json({ success: true, message: 'Exam data saved and computed successfully' });

  } catch (err) {
    console.error('Error adding exam score:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (schoolDb) await schoolDb.end();
  }
});
module.exports = router;
