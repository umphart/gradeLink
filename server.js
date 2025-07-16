const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// Configure directories
const baseDir = process.env.NODE_ENV === 'production' 
  ? '/opt/render/project/src'  // Render.com production path
  : __dirname;                 // Local development path

const uploadDir = path.join(baseDir, 'uploads');
const teacherPhotoDir = path.join(baseDir, 'uploads', 'teachers');

// Create directories with error handling
[uploadDir, teacherPhotoDir].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  } catch (err) {
    console.error(`❌ Failed to create directory ${dir}:`, err);
    process.exit(1); // Exit if we can't create essential directories
  }
});

// Enhanced CORS Configuration
const corsOptions = {
  origin: [
    'https://grade-linkfrontend.vercel.app',
    'http://localhost:3000',
    'https://gradelink.onrender.com' // Add your Render URL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Improved body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files with cache control
app.use('/uploads', express.static(uploadDir, {
  maxAge: '1d', // Cache for 1 day
  setHeaders: (res, path) => {
    if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/' + path.split('.').pop());
    }
  }
}));

// Enhanced logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${timestamp}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });

  console.log(`🔍 Incoming: ${req.method} ${req.originalUrl}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  }
  
  next();
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

// Add this to your Express routes
app.get('/', (req, res) => {
  const teacherPhotoDir = path.join(__dirname, '../uploads/teachers');

  fs.readdir(teacherPhotoDir, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      return res.status(500).json({
        success: false,
        error: 'Failed to read images directory',
        details: err.message
      });
    }

    // Filter only image files
    const imageFiles = files.filter(file => 
      ['.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(file).toLowerCase())
    );

    res.json({
      success: true,
      count: imageFiles.length,
      images: imageFiles.map(file => ({
        name: file,
        url: `https://gradelink.onrender.com/uploads/teachers/${file}`
      }))
    });
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});