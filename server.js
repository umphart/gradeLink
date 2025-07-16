const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// ======================
// 1. Directory Configuration
// ======================
const baseDir = process.env.NODE_ENV === 'production' 
  ? '/opt/render/project/src'  // Render.com
  : __dirname;                 // Local

const uploadDir = path.join(baseDir, 'uploads');
const teacherPhotoDir = path.join(uploadDir, 'teachers');

// Create directories with validation
[uploadDir, teacherPhotoDir].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Directory created: ${dir}`);
    }
  } catch (err) {
    console.error(`❌ Critical directory error:`, err);
    process.exit(1);
  }
});

// ======================
// 2. CORS Configuration
// ======================
const corsOptions = {
  origin: [
    'https://grade-linkfrontend.vercel.app',
    'http://localhost:3000',
    'https://gradelink.onrender.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
};

// ======================
// 3. Middleware Setup
// ======================
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ======================
// 4. Static File Serving
// ======================
app.use('/uploads/teachers', express.static(teacherPhotoDir, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      res.set('Content-Type', `image/${ext.slice(1)}`);
    }
  }
}));

app.get('/api/teachers/images', (req, res) => {
  fs.readdir(teacherPhotoDir, (err, files) => {
    if (err) {
      console.error('Directory read error:', err);
      return res.status(500).json({ error: 'Failed to read images' });
    }

    const images = files
      .filter(file => /\.(png|jpg|jpeg)$/i.test(file))
      .map(file => ({
        name: file,
        url: `https://${req.get('host')}/uploads/teachers/${file}`,
        path: path.join(teacherPhotoDir, file)
      }));

    res.json({ 
      success: true,
      count: images.length,
      images 
    });
  });
});

// ======================
// 5. Enhanced Logging Middleware
// ======================
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

// ======================
// 6. Routes
// ======================
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

// ======================
// 7. Health Check
// ======================
app.get('/', (req, res) => {
  res.send('GradeLink API is running............ ✅');
});

// ======================
// 8. Error Handling
// ======================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    success: false,
    message: 'Internal server error'
  });
});

// ======================
// 9. Server Startup
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});