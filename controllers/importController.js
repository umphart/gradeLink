const csv = require('csv-parser');
const fs = require('fs');
const pool = require('../models/db');

exports.importStudents = async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file was uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`Starting import from file: ${req.file.originalname}`);
    const results = [];
    const errors = [];

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => {
        console.log('Processing row:', data); // Log each row being processed
        
        // Validate required fields
        if (!data.full_name || !data.class_name || !data.section || !data.gender) {
          const errorMsg = `Missing required fields in row: ${JSON.stringify(data)}`;
          console.error(errorMsg);
          errors.push(errorMsg);
          return;
        }

        // Add timestamp to student data
        const studentRecord = {
          ...data,
          import_timestamp: new Date().toISOString()
        };
        
        results.push(studentRecord);
        console.log('Valid student record:', studentRecord);
      })
      .on('end', async () => {
        console.log('\n=== Import Summary ===');
        console.log(`Total records processed: ${results.length + errors.length}`);
        console.log(`Successfully imported: ${results.length}`);
        console.log(`Failed records: ${errors.length}\n`);
        
        if (results.length > 0) {
          console.log('Successfully imported students:');
          results.forEach((student, index) => {
            console.log(`${index + 1}. ${student.full_name} (${student.admission_number || 'N/A'}) - ${student.class_name}`);
          });
        }

        if (errors.length > 0) {
          console.error('\nImport errors:');
          errors.forEach((error, index) => {
            console.error(`${index + 1}. ${error}`);
          });
        }

        fs.unlinkSync(req.file.path); // Clean up file
        
        try {
          // Insert into database
          for (const student of results) {
            const { full_name, class_name, section, gender, age, guidance_name, guidance_contact, disability_status } = student;
            
            await pool.query(
              `INSERT INTO ${section}_students 
              (full_name, class_name, section, gender, age, guidance_name, guidance_contact, disability_status)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                full_name,
                class_name,
                section,
                gender,
                age || null,
                guidance_name || null,
                guidance_contact || null,
                disability_status || null
              ]
            );
            console.log(`Inserted student: ${full_name}`);
          }
          
          res.json({
            success: true,
            imported: results.length,
            errors: errors
          });
        } catch (dbError) {
          console.error('Database insertion error:', dbError);
          res.status(500).json({ error: 'Database operation failed' });
        }
      })
      .on('error', (error) => {
        console.error('CSV processing error:', error);
        fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Error processing CSV file' });
      });
  } catch (error) {
    console.error('Unexpected error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
};

// Similar implementations for teachers and exams...
exports.importTeachers = async (req, res) => {
  // Implementation similar to importStudents with appropriate logging
};

exports.importExams = async (req, res) => {
  // Implementation similar to importStudents with appropriate logging
};