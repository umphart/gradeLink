const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();

// Ensure upload directory exists
 const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// CORS Configuration
app.use(cors({
  origin: [
    'https://grade-linkfrontend.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

app.use((req, res, next) => {
  console.log(`🔍 ${req.method} ${req.url}`);
  next();
})
const schoolRoutes = require('./routes/schools');
const loginRoutes = require('./routes/login');
const students = require('./routes/students');
const studentsLogin = require('./routes/studentsLogin');
const school= require('./routes/schoolRoutes')
const teachersRoutes = require('./routes/teachersRoutes');
const teacherLoginRoutes = require('./routes/teachersLogin');
const subjectsRouter = require('./routes/subjects'); 
const importRoutes = require('./routes/importRoutes');
const importTeachers =require('./routes/teacherImport')
const importExam = require('./routes/importExam')

app.use('/api/import', importExam)
app.use('/api/import', importTeachers)
app.use('/api/import', importRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/schools', schoolRoutes);
app.use('/api/login', loginRoutes);
app.use('/api/students', students);
app.use('/api/studentsLogin', studentsLogin);
app.use('/api/school-count', school);
app.use('/api/teacher-count', school);
app.use('/api/teachers', teachersRoutes);
app.use('/api/teachers', require('./routes/teachersRoutes'));
app.use('/api/teachersLogin', teacherLoginRoutes);


app.use('/api/subjects', subjectsRouter);






app.get('/', (req, res) => {
  res.send('GradeLink API is running ✅');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
