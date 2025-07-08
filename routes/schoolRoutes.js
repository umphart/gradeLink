const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const getSchoolDbConnection = require('../utils/dbSwitcher');

// ✅ GET - Dashboard statistics (counts for schools, admins, students)
router.get('/dashboard-stats', async (req, res) => {
  try {
    // Execute all count queries in parallel
    const [schoolsCount, adminsCount, studentsCount] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM schools'),
      pool.query('SELECT COUNT(*) FROM admins'),
      pool.query(`
        SELECT SUM(student_count) as total_students 
        FROM (
          SELECT COUNT(*) as student_count 
          FROM students_login 
          GROUP BY school_db_name
        ) as subquery
      `)
    ]);

    res.json({
      schools: parseInt(schoolsCount.rows[0].count),
      admins: parseInt(adminsCount.rows[0].count),
      students: parseInt(studentsCount.rows[0].total_students || 0)
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET - Total admin count
router.get('/admin-count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM admins');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET - All admins with school info
router.get('/admins', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, s.name as school_name 
      FROM admins a
      LEFT JOIN schools s ON a.school_id = s.id
      ORDER BY a.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET - All schools
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM schools ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET - Total student count (across all schools)
router.get('/student-count', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT SUM(student_count) as total_students 
      FROM (
        SELECT COUNT(*) as student_count 
        FROM students_login 
        GROUP BY school_db_name
      ) as subquery
    `);
    res.json({ count: parseInt(result.rows[0].total_students || 0) });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET - Student count per school with school details
router.get('/students-per-school', async (req, res) => {
  try {
    // First get all schools
    const schoolsResult = await pool.query('SELECT id, name FROM schools');
    const schools = schoolsResult.rows;
    
    // Then get student count for each school
    const studentCounts = await Promise.all(
      schools.map(async (school) => {
        const countResult = await pool.query(
          'SELECT COUNT(*) FROM students_login WHERE school_db_name = $1',
          [`school_${school.name.replace(/\s+/g, '_').toLowerCase()}`]
        );
        return {
          school_id: school.id,
          school_name: school.name,
         
          student_count: parseInt(countResult.rows[0].count)
        };
      })
    );
    
    res.json(studentCounts);
  } catch (error) {
    console.error('Error fetching students per school:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      details: error.message 
    });
  }
});

// ✅ GET - All students (if needed)
router.get('/students', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM students_login
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// ✅ GET - All schools
router.get('/schools', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM schools ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET - All admins
router.get('/admins', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, s.name as school_name 
      FROM admins a
      LEFT JOIN schools s ON a.school_id = s.id
      ORDER BY a.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET - All schools with their admin details (expanded version)
router.get('/schools-with-admins', async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id AS school_id,
        s.name AS school_name,
        s.email AS school_email,
        s.phone AS school_phone,
        s.address,
        s.city,
        s.state,
        s.logo,
        s.db_name,
        s.created_at AS school_created_at,
        COUNT(sl.*) AS student_count,
        a.id AS admin_id,
        a.first_name,
        a.last_name,
        a.email AS admin_email,
        a.phone AS admin_phone,
        a.created_at AS admin_created_at
      FROM schools s
      LEFT JOIN admins a ON s.id = a.school_id
      LEFT JOIN students_login sl ON s.db_name = sl.school_db_name
      GROUP BY s.id, a.id
      ORDER BY s.id DESC;
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching schools with admins:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// ✅ GET - All teachers across all schools (for admin dashboard)

// ✅ GET - All teachers
router.get('/getTeachers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM teachers_login
    `);

    const totalTeachers = result.rowCount;

    res.json({
      total: totalTeachers,
      teachers: result.rows
    });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      details: error.message 
    });
  }
});

// ✅ GET - Teacher count per school with school details
router.get('/teachers-per-school', async (req, res) => {
  try {
    // First get all schools
    const schoolsResult = await pool.query('SELECT id, name FROM schools');
    const schools = schoolsResult.rows;

    // Then get teacher count for each school
    const teacherCounts = await Promise.all(
      schools.map(async (school) => {
        const countResult = await pool.query(
          'SELECT COUNT(*) FROM teachers_login WHERE school_db_name = $1',
          [`school_${school.name.replace(/\s+/g, '_').toLowerCase()}`]
        );
        return {
          school_id: school.id,
          school_name: school.name,
          teacher_count: parseInt(countResult.rows[0].count)
        };
      })
    );

    res.json(teacherCounts);
  } catch (error) {
    console.error('Error fetching teachers per school:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      details: error.message
    });
  }
});
// ✅ GET - Single teacher by ID
router.get('/teachers/:id', async (req, res) => {
  const { id } = req.params;
  const { schoolName } = req.query;

  if (!schoolName) {
    return res.status(400).json({ error: 'schoolName is required' });
  }

  let schoolDb;
  try {
    const schoolDbName = `school_${schoolName.replace(/\s+/g, '_').toLowerCase()}`;
    schoolDb = await getSchoolDbConnection(schoolDbName);

    const result = await schoolDb.query(
      `SELECT 
        t.*,
        tl.password,
        tl.school_name
      FROM teachers t
      JOIN teachers_login tl ON t.teacher_id = tl.teacher_id
      WHERE t.teacher_id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Teacher not found' 
      });
    }

    res.json({
      success: true,
      teacher: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching teacher:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch teacher'
    });
  } finally {
    if (schoolDb) schoolDb.release();
  }
});



module.exports = router;