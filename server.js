const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Database configuration for Render PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://school_admin:gF3BgZ6FIZJ6A0dIUyhjtRA9cZ4o7VBe@dpg-d1mfbe2dbo4c73f8apig-a.oregon-postgres.render.com/school_management_aymr',
  ssl: {
    rejectUnauthorized: false // Required for Render PostgreSQL
  },
  max: 5, // Connection pool size (keep low for free tier)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Test database connection on startup
pool.query('SELECT NOW()')
  .then(res => console.log('✅ Database connected at:', res.rows[0].now))
  .catch(err => console.error('❌ Database connection error:', err));

// CORS configuration
const corsOptions = {
  origin: [
    'https://grade-linkfrontend.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
const uploadsDir = path.join(__dirname, 'uploads');
app.use('/uploads/logos', express.static(path.join(uploadsDir, 'logos')));
app.use('/uploads/students', express.static(path.join(uploadsDir, 'students')));

// File upload configuration
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Routes
const schoolRoutes = require('./routes/schools');
app.use('/schools', schoolRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'GradeLink Backend API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: 'Render PostgreSQL'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${pool.options.connectionString.split('@')[1]}`);
});