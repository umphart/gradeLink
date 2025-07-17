const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// Enhanced upload directory configuration
const configureUploadDirectory = () => {
  // Use Render's persistent storage if available, otherwise local uploads
  const baseDir = process.env.RENDER 
    ? '/var/data/uploads'  // Render persistent storage
    : path.join(__dirname, 'uploads');

  const logoDir = path.join(baseDir, 'logos');
  
  // Create directory structure if it doesn't exist
  if (!fs.existsSync(logoDir)) {
    fs.mkdirSync(logoDir, { recursive: true });
    console.log(`Created upload directory: ${logoDir}`);
  }
  
  return logoDir;
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
  credentials: true
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files - serve from the correct upload directory
app.use('/uploads', express.static(uploadDir));

// Enhanced logging middleware with file upload awareness
app.use((req, res, next) => {
  console.log(`🔍 ${req.method} ${req.url}`);
  if (req.file) {
    console.log(`📁 File upload detected: ${req.file.originalname}`);
  }
  next();
});

// File existence verification endpoint
app.get('/verify-upload/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error(`File not found: ${filePath}`);
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

// Error handling for file operations
process.on('unhandledRejection', (err) => {
  if (err.code === 'ENOENT') {
    console.error('File system error:', err.message);
  }
});

// Routes
const schoolRoutes = require('./routes/schools')
const loginRoute = require('./routes/login')
const teacherRoutes = require('./routes/teachersRoutes');
const teachersLoginRoute = require('./routes/teachersLogin');
const studentRoutes = require('./routes/students');
const studentsLoginRoute = require('./routes/studentsLogin');
const subjectRoute = require('./routes/subjects')

app.use('/api/subjects', subjectRoute);
app.use('/api/students-login', studentsLoginRoute);
app.use('/api/teachers', teacherRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/login', loginRoute);
app.use('/api/teachers-login', teachersLoginRoute);
app.use('/api/students', studentRoutes);

// Health check
app.get('/', (req, res) => {
  res.send('GradeLink API is running............ ✅');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    success: false,
    message: 'Internal server error'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});