require('dotenv').config();
const express = require('express');
const pool = require('./models/db');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// ======================
// Middleware Setup
// ======================
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// ======================
// File Upload Configuration
// ======================
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subfolder = file.fieldname === 'logo' ? 'logos' : 'students';
    const dest = path.join(uploadDir, subfolder);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ======================
// Static Files
// ======================
app.use('/uploads', express.static(uploadDir));
app.use('/uploads/logos', express.static(path.join(uploadDir, 'logos')));
app.use('/uploads/students', express.static(path.join(uploadDir, 'students')));

// ======================
// Route Imports
// ======================
const schoolRoutes = require('./routes/schools');
const loginRoutes = require('./routes/login');
const students = require('./routes/students');
const studentsLogin = require('./routes/studentsLogin');
const schoolStats = require('./routes/schoolRoutes');
const teachersRoutes = require('./routes/teachersRoutes');
const teacherLoginRoutes = require('./routes/teachersLogin');
const subjectsRouter = require('./routes/subjects');
const importRoutes = require('./routes/importRoutes');
const importTeachers = require('./routes/teacherImport');
const importExam = require('./routes/importExam');

// ======================
// Route Middlewares
// ======================
app.use('/api/import', importExam);
app.use('/api/import', importTeachers);
app.use('/api/import', importRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/login', loginRoutes);
app.use('/api/students', students);
app.use('/api/studentsLogin', studentsLogin);
app.use('/api/school-count', schoolStats);
app.use('/api/teacher-count', schoolStats);
app.use('/api/teachers', teachersRoutes);
app.use('/api/teachersLogin', teacherLoginRoutes);
app.use('/api/subjects', subjectsRouter);

// ======================
// Health Check & Root Route
// ======================
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'GradeLink Backend Service',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message,
      database: 'disconnected'
    });
  }
});

// ======================
// Error Handling
// ======================
app.use((req, res, next) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ======================
// Server Startup
// ======================
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`Listening on port ${PORT}`);
  console.log(`Upload directory: ${uploadDir}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

module.exports = app; // For testing