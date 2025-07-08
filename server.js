require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 10000;

// ============================================
// Database Configuration (Render PostgreSQL)
// ============================================
const mainPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://school_admin:gF3BgZ6FIZJ6A0dIUyhjtRA9cZ4o7VBe@dpg-d1mfbe2dbo4c73f8apig-a.oregon-postgres.render.com/school_management_aymr',
  ssl: {
    rejectUnauthorized: false // Required for Render PostgreSQL
  },
  max: 5, // Connection pool size
  idleTimeoutMillis: 30000
});

// Test database connection
mainPool.query('SELECT NOW()')
  .then(() => console.log('✅ Connected to PostgreSQL database'))
  .catch(err => console.error('❌ Database connection error:', err));

// ============================================
// Middleware Configuration
// ============================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", ...process.env.ALLOWED_ORIGINS?.split(',') || []]
    }
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-school-name']
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200 // Limit each IP to 200 requests per windowMs
}));

app.use(express.json());
app.use(morgan('combined')); // HTTP request logging

// ============================================
// File Upload Configuration (Render Persistent Storage)
// ============================================
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
    const ext = path.extname(file.originalname);
    cb(null, `${req.schoolId || 'default'}-${Date.now()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ============================================
// Database Selector Middleware (Multi-school)
// ============================================
const dbSelector = async (req, res, next) => {
  const schoolName = req.headers['x-school-name'] || req.query.school;
  
  if (!schoolName) {
    return res.status(400).json({ error: 'School identifier required' });
  }

  try {
    const dbName = `school_${schoolName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    
    // Verify or create database
    await mainPool.query(
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`
    ).then(async ({ rowCount }) => {
      if (rowCount === 0) {
        await mainPool.query(`CREATE DATABASE ${dbName}`);
        console.log(`Created new school database: ${dbName}`);
      }
    });

    // Create connection pool for this school
    req.db = new Pool({
      connectionString: process.env.DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`),
      ssl: { rejectUnauthorized: false }
    });

    req.schoolId = schoolName;
    next();
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'School database unavailable' });
  }
};

// ============================================
// Static Files and Routes
// ============================================
app.use('/uploads', express.static(uploadDir));

// Import route handlers
const schoolRoutes = require('./routes/schools');
const authRoutes = require('./routes/auth');
// ... other route imports

// Apply routes
app.use('/api/schools', dbSelector, schoolRoutes);
app.use('/api/auth', authRoutes);
// ... other routes

// ============================================
// Health Check and Monitoring
// ============================================
app.get('/health', async (req, res) => {
  try {
    await mainPool.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: 'connected',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      uploads: fs.existsSync(uploadDir) ? 'active' : 'inactive'
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'GradeLink Backend',
    status: 'running',
    database: process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'local',
    nodeEnv: process.env.NODE_ENV
  });
});

// ============================================
// Error Handling
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { details: err.message })
  });
});

// ============================================
// Server Startup
// ============================================
app.listen(PORT, () => {
  console.log(`
  🚀 Server running in ${process.env.NODE_ENV || 'development'} mode
  📡 Listening on port ${PORT}
  📂 Upload directory: ${uploadDir}
  🗄️  Database: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'local'}
  `);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

module.exports = app;