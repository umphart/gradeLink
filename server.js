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






// Test route
app.get('/', (req, res) => {
  res.send('GradeLink Backend is Running');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
