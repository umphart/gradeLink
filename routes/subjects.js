const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const getSchoolDbConnection = require('../utils/dbSwitcher');

const router = express.Router();

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    if (ext !== '.csv') {
      return cb(new Error('Only CSV files are allowed'), false);
    }
    cb(null, true);
  }
});
// Route: Import subjects from CSV
router.post('/import-subjects', upload.single('subjectsFile'), async (req, res) => {

  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const { schoolName } = req.body;

  if (!schoolName) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: 'School name is required' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
  const filePath = req.file.path;
  const subjects = [];

  try {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        if (row.subject_name && row.subject_code && row.classname) {
          subjects.push({
            subject_name: row.subject_name,
            description: row.description || '',
            subject_code: row.subject_code,
            classname: row.classname
          });
        }
      })
      .on('end', async () => {
        if (subjects.length === 0) {
          fs.unlinkSync(filePath);
          return res.status(400).json({ message: 'No valid subjects found in CSV' });
        }

        try {
          const db = await getSchoolDbConnection(dbName);
          const insertedSubjects = [];

          for (const subject of subjects) {
            const query = `
              INSERT INTO subjects (subject_name, description, subject_code, classname)
              VALUES ($1, $2, $3, $4)
              RETURNING *;
            `;
            const result = await db.query(query, [
              subject.subject_name,
              subject.description,
              subject.subject_code,
              subject.classname
            ]);
            insertedSubjects.push(result.rows[0]);
          }

          fs.unlinkSync(filePath);
          res.status(201).json({
            success: true,
            message: 'Subjects imported successfully',
            count: insertedSubjects.length,
           imported: insertedSubjects
          });
        } catch (err) {
          console.error('DB import error:', err);
          fs.unlinkSync(filePath);
          res.status(500).json({ message: 'Failed to import subjects', error: err.message });
        }
      });
  } catch (err) {
    console.error('CSV processing error:', err);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ message: 'Error processing file', error: err.message });
  }
});
// Route: Add a new subject
router.post('/add', async (req, res) => {
  const { schoolName, subject_name, description, subject_code, classname } = req.body;

  if (!schoolName || !subject_name || !subject_code || !classname) { // Fixed space before classname
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    const insertQuery = `
      INSERT INTO subjects (subject_name, description, subject_code, classname)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const result = await schoolDb.query(insertQuery, [
      subject_name,
      description || '',
      subject_code,
      classname
    ]);

    res.status(201).json({ message: 'Subject added successfully', subject: result.rows[0] });
  } catch (err) {
    console.error('Error adding subject:', err);
    res.status(500).json({ message: 'Failed to add subject', error: err.message });
  }
});

// Route: Get all subjects for a specific school
router.get('/all', async (req, res) => {
  const { schoolName } = req.query;

  if (!schoolName) {
    return res.status(400).json({ message: 'Missing schoolName in query' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    const result = await schoolDb.query('SELECT * FROM subjects ORDER BY subject_name ASC');

    res.status(200).json({ subjects: result.rows });
  } catch (err) {
    console.error('Error fetching subjects:', err);
    res.status(500).json({ message: 'Failed to fetch subjects', error: err.message });
  }
});

// Route: Update a subject
router.put('/update', async (req, res) => {
  const { schoolName, subject_id, subject_name, description, subject_code } = req.body;

  if (!schoolName || !subject_id || !subject_name || !subject_code) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    const updateQuery = `
      UPDATE subjects
      SET subject_name = $1, description = $2, subject_code = $3
      WHERE id = $4
      RETURNING *;
    `;

    const result = await schoolDb.query(updateQuery, [
      subject_name,
      description || '',
      subject_code,
      subject_id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.json({ message: 'Subject updated successfully', subject: result.rows[0] });
  } catch (err) {
    console.error('Error updating subject:', err);
    res.status(500).json({ message: 'Failed to update subject', error: err.message });
  }
});

// Route: Delete a subject
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  const { schoolName } = req.query;

  if (!schoolName) {
    return res.status(400).json({ message: 'School name is required' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    const deleteQuery = 'DELETE FROM subjects WHERE id = $1 RETURNING *;';
    const result = await schoolDb.query(deleteQuery, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.status(200).json({ message: 'Subject deleted successfully' });
  } catch (err) {
    console.error('Error deleting subject:', err);
    res.status(500).json({ message: 'Failed to delete subject', error: err.message });
  }
});

// Route: Assign a subject to a teacher
router.post('/assign-subject', async (req, res) => {
  const {
    schoolName,
    teacher_id,
    subject_id,
    teacher_name,
    subject_name,
    subject_code,
    classname
  } = req.body;

  if (!schoolName || !teacher_id || !subject_id) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    const insertQuery = `
      INSERT INTO teacher_subjects (
        teacher_id,
        subject_id,
        teacher_name,
        subject_name,
        subject_code,
        classname
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (teacher_id, subject_id) DO NOTHING
      RETURNING *;
    `;

    const result = await schoolDb.query(insertQuery, [
      teacher_id,
      subject_id,
      teacher_name,
      subject_name,
      subject_code,
      classname 
    ]);

    if (result.rows.length === 0) {
      return res.status(200).json({ message: 'Assignment already exists' });
    }

    res.status(201).json({
      message: 'Subject assigned successfully',
      assignment: result.rows[0]
    });
  } catch (err) {
    console.error('Error assigning subject:', err);
    res.status(500).json({ message: 'Failed to assign subject', error: err.message });
  }
});

// Route: Get all subjects assigned to a specific teacher
router.get('/assigned', async (req, res) => {
  const { schoolName, teacher_id } = req.query;

  if (!schoolName || !teacher_id) {
    return res.status(400).json({ message: 'Missing schoolName or teacher_id' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    const query = `
      SELECT * FROM teacher_subjects
      WHERE teacher_id = $1
      ORDER BY subject_name ASC
    `;

    const result = await schoolDb.query(query, [teacher_id]);

    res.status(200).json({ subjects: result.rows });
  } catch (error) {
    console.error('Error fetching assigned subjects:', error);
    res.status(500).json({ message: 'Failed to fetch assigned subjects', error: error.message });
  }
});

// Route: Get all classes assigned to a specific teacher
router.get('/assigned-classes', async (req, res) => {
  const { schoolName, teacher_id } = req.query;

  if (!schoolName || !teacher_id) {
    return res.status(400).json({ message: 'Missing schoolName or teacher_id' });
  }

  const dbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;

  try {
    const schoolDb = await getSchoolDbConnection(dbName);

    const query = `
      SELECT class_name, section, teacher_name, assigned_at
      FROM teacher_classes
      WHERE teacher_id = $1
      ORDER BY class_name, section
    `;

    const result = await schoolDb.query(query, [teacher_id]);

    res.status(200).json({ classes: result.rows });
  } catch (error) {
    console.error('Error fetching assigned classes:', error);
    res.status(500).json({ message: 'Failed to fetch assigned classes', error: error.message });
  }
});

module.exports = router;