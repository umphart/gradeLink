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

// Storage configurations (unchanged)
const importStorage = multer.diskStorage({ /* ... */ });
const photoStorage = multer.diskStorage({ /* ... */ });

// Upload configurations (unchanged)
const uploadImport = multer({ /* ... */ });
const uploadPhoto = multer({ /* ... */ });

// Helper functions (unchanged)
function generateRandomPassword(length = 8) { /* ... */ }
async function generateTeacherId(schoolDb, school, department) { /* ... */ }

// Improved add teacher route
router.post('/add-teacher', uploadPhoto.single('photo'), async (req, res) => {
  let schoolDb;
  let centralDb;

  try {
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
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'School name, full name, and department are required',
      });
    }

    // Connect to central DB with timeout handling
    centralDb = await pool.connect();
    
    // Normalize school name for query
    const normalizedSchoolName = schoolName.trim().toLowerCase();
    
    const schoolInfo = await centralDb.query(
      'SELECT id, name, logo FROM schools WHERE LOWER(TRIM(name)) = $1 OR id = $2',
      [normalizedSchoolName, schoolId || null]
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
    
    // Connect to school DB with timeout handling
    schoolDb = await getSchoolDbConnection(dbName, { connectionTimeoutMillis: 10000 });

    await schoolDb.query('BEGIN');

    // Generate teacher ID and password
    const teacherId = await generateTeacherId(schoolDb, school, department);
    const teacherPassword = generateRandomPassword();

    // Insert teacher record
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
    if (schoolDb) {
      try {
        await schoolDb.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback error:', rollbackErr);
      }
      await schoolDb.end();
    }
    
    if (req.file) fs.unlinkSync(req.file.path);
    
    console.error('Add teacher error:', err);
    
    if (err.code === '23505') {
      return res.status(409).json({ 
        success: false, 
        message: 'Teacher with similar details already exists'
      });
    }

    if (err.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        message: 'Database connection timed out. Please try again.'
      });
    }

    return res.status(500).json({ 
      success: false, 
      message: 'Failed to add teacher', 
      error: err.message
    });
  } finally {
    if (centralDb) centralDb.release();
  }
});

// Improved get teachers route
router.get('/', async (req, res) => {
  let schoolDb;
  try {
    const { schoolName, schoolId } = req.query;
    
    if (!schoolName && !schoolId) {
      return res.status(400).json({
        success: false,
        message: 'School name or ID is required'
      });
    }

    const centralDb = await pool.connect();
    
    const schoolInfo = await centralDb.query(
      'SELECT id, name FROM schools WHERE LOWER(TRIM(name)) = $1 OR id = $2',
      [schoolName?.trim().toLowerCase(), schoolId || null]
    );

    if (schoolInfo.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'School not found'
      });
    }

    const school = schoolInfo.rows[0];
    const dbName = `school_${school.name.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(dbName, { connectionTimeoutMillis: 10000 });

    const teachers = await schoolDb.query(
      'SELECT teacher_id, full_name, email, phone, gender, department, photo_url FROM teachers'
    );

    return res.status(200).json({
      success: true,
      data: teachers.rows
    });

  } catch (err) {
    console.error('Error fetching teachers:', err);
    
    if (err.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        message: 'Database connection timed out. Please try again.'
      });
    }

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