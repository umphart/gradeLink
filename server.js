const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os'); // Added for temp directory fallback
const app = express();

// Enhanced upload directory configuration
const configureUploadDirectory = () => {
  // Determine base directory based on environment
  const baseDir = process.env.RENDER 
    ? path.join(process.env.RENDER_PERSISTENT_DIR || '/var/data', 'uploads')
    : path.join(__dirname, 'uploads');

  const logoDir = path.join(baseDir, 'logos');
  
  try {
    // Create directory structure if it doesn't exist
    if (!fs.existsSync(logoDir)) {
      fs.mkdirSync(logoDir, { recursive: true, mode: 0o755 });
      console.log(`Created upload directory: ${logoDir}`);
    }
    return logoDir;
  } catch (err) {
    console.error('Error creating upload directory:', err);
    // Fallback to temporary directory if persistent storage fails
    const tempDir = path.join(os.tmpdir(), 'grade-link-uploads', 'logos');
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Using temporary directory: ${tempDir}`);
    return tempDir;
  }
};

const uploadDir = configureUploadDirectory();

// CORS Configuration
app.use(cors({
  origin: [
    'https://grade-linkfrontend.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Added for authenticated requests
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files - serve from the correct upload directory
app.use('/uploads', express.static(uploadDir, {
  setHeaders: (res) => {
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  }
}));

// Enhanced logging middleware
app.use((req, res, next) => {
  console.log(`🔍 ${req.method} ${req.url}`, {
    body: req.body,
    query: req.query,
    params: req.params
  });
  next();
});

// Routes
const schoolRoutes = require('./routes/schools');
const loginRoute = require('./routes/login');
const teacherRoutes = require('./routes/teachersRoutes');
const teachersLoginRoute = require('./routes/teachersLogin');
const studentRoutes = require('./routes/students');
const studentsLoginRoute = require('./routes/studentsLogin');
const subjectRoute = require('./routes/subjects');

app.use('/api/subjects', subjectRoute);
app.use('/api/students-login', studentsLoginRoute);
app.use('/api/teachers', teacherRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/login', loginRoute);
app.use('/api/teachers-login', teachersLoginRoute);
app.use('/api/students', studentRoutes);

// Health check endpoint with system info
app.get('/', (req, res) => {
  res.json({
    status: 'GradeLink API is running ✅',
    uploadDirectory: uploadDir,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    memoryUsage: process.memoryUsage()
  });
});

// File verification endpoint
app.get('/api/verify-upload/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ 
        exists: false,
        path: filePath,
        message: 'File not found'
      });
    }
    res.json({ 
      exists: true,
      path: filePath,
      url: `/uploads/${req.params.filename}`
    });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack || err);
  res.status(500).json({ 
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

// Cleanup temporary files on exit if using temp directory
if (uploadDir.includes('tmp')) {
  process.on('exit', () => {
    try {
      fs.rmSync(uploadDir, { recursive: true });
      console.log('Cleaned up temporary upload directory');
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  });
}

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
});