//routes/importExam.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const getSchoolDbConnection = require('../utils/dbSwitcher');
const { getGrade, getRemark, updateAveragesAndPositions } = require('../utils/examUtils');

const upload = multer({ storage: multer.memoryStorage() });

// Common validation and processing functions
const validateExamParameters = (schoolName, className, sessionName, termName) => {
  if (!schoolName || !className || !sessionName || !termName) {
    throw new Error('Missing required parameters: schoolName, className, sessionName, termName');
  }
};

const processExamRecord = async (schoolDb, examTable, record, className, sessionId, termId) => {
  const { student_name, admission_number, subject, exam_mark, ca } = record;
  const total = parseInt(exam_mark || 0) + parseInt(ca || 0);
  const grade = getGrade(total);
  const remark = getRemark(grade);

  await schoolDb.query(
    `INSERT INTO "${examTable}" 
      (school_id, student_name, admission_number, class_name, subject, exam_mark, ca, total, remark, session_id, term_id)
     VALUES 
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [1, student_name, admission_number, className, subject, exam_mark, ca, total, remark, sessionId, termId]
  );
};

const getOrCreateSession = async (schoolDb, sessionName) => {
  let sessionResult = await schoolDb.query(
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
  return sessionId;
};

const getOrCreateTerm = async (schoolDb, termName) => {
  let termResult = await schoolDb.query(
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
  return termId;
};

// File Import Route
router.post('/exams', upload.single('file'), async (req, res) => {
  let schoolDb;
  try {
    const { schoolName, className, sessionName, termName } = req.body;
    const file = req.file;

    validateExamParameters(schoolName, className, sessionName, termName);
    if (!file) throw new Error('No file uploaded');

    // Process file based on type
    const fileType = file.mimetype;
    let examData = [];

    if (fileType === 'text/csv' || fileType === 'application/vnd.ms-excel') {
      examData = await parseCSV(file.buffer);
    } else if (
      fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      fileType === 'application/vnd.ms-excel'
    ) {
      examData = await parseExcel(file.buffer);
    } else {
      throw new Error('Invalid file type. Only CSV or Excel files are allowed.');
    }

    // Normalize school DB name
    const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName);

    const normalizedClassName = className.toLowerCase().replace(/\s+/g, '');
    const examTable = `${normalizedClassName}_exam`;

    // Get or create session and term
    const sessionId = await getOrCreateSession(schoolDb, sessionName);
    const termId = await getOrCreateTerm(schoolDb, termName);

    // Process each record
    for (const record of examData) {
      await processExamRecord(schoolDb, examTable, record, className, sessionId, termId);
    }

    // Update statistics
    await updateAveragesAndPositions(schoolDb, examTable);

    res.status(201).json({ 
      success: true, 
      message: 'Exam data imported successfully',
      imported: examData.length
    });

  } catch (err) {
    console.error('Import error:', err);
    res.status(400).json({ 
      success: false, 
      message: err.message,
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (schoolDb) await schoolDb.end();
  }
});

// Manual Score Addition Route
router.post('/add', async (req, res) => {
  let schoolDb;
  try {
    const { schoolName, className, sessionName, termName, examData } = req.body;

    validateExamParameters(schoolName, className, sessionName, termName);
    if (!examData || !Array.isArray(examData)) {
      throw new Error('Exam data must be provided as an array');
    }

    // Normalize school DB name
    const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName);

    const normalizedClassName = className.toLowerCase().replace(/\s+/g, '');
    const examTable = `${normalizedClassName}_exam`;

    // Get or create session and term
    const sessionId = await getOrCreateSession(schoolDb, sessionName);
    const termId = await getOrCreateTerm(schoolDb, termName);

    // Process each record
    for (const record of examData) {
      await processExamRecord(schoolDb, examTable, record, className, sessionId, termId);
    }

    // Update statistics
    await updateAveragesAndPositions(schoolDb, examTable);

    res.status(201).json({ 
      success: true, 
      message: 'Exam scores added successfully',
      added: examData.length
    });

  } catch (err) {
    console.error('Add score error:', err);
    res.status(400).json({ 
      success: false, 
      message: err.message,
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (schoolDb) await schoolDb.end();
  }
});

// Helper functions for file parsing
function parseCSV(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = require('stream');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    bufferStream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

function parseExcel(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return xlsx.utils.sheet_to_json(worksheet);
}

module.exports = router;