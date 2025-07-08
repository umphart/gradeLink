const express = require('express');
const pool = require('./models/db'); 
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


app.use('/uploads/logos', express.static('uploads/logos'));
app.use('/uploads/students', express.static('uploads/students'));

const upload = multer({ dest: 'uploads/' });
const schoolRoutes = require('./routes/schools');


// Test route
app.get('/', (req, res) => {
  res.send('GradeLink Backend is Running');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
