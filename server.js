const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
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

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/uploads', express.static(uploadDir));

// Logging middleware
app.use((req, res, next) => {
  console.log(`🔍 ${req.method} ${req.url}`);
  next();
});

// Routes
const schoolRoutes = require('./routes/schools')
const loginRoute = require('./routes/login')

app.use('/api/schools', schoolRoutes);
app.use('/api/login', loginRoute);

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