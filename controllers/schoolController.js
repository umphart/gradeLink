const db = require('../models/db');
const bcrypt = require('bcryptjs');

exports.registerSchool = async (req, res) => {
  const client = await db.connect();
  try {
    const { school, admin } = req.body;
    const {
      name, email, phone, address: addr
    } = school;
    const {
      street, city, state, country, postalCode
    } = addr;

    const passwordHash = await bcrypt.hash(admin.password, 10);

    await client.query('BEGIN');

    const schoolInsert = await client.query(
      `INSERT INTO schools (name, email, phone, address, city, state, country, postal_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [name, email, phone, street, city, state, country, postalCode]
    );

    const schoolId = schoolInsert.rows[0].id;

    await client.query(
      `INSERT INTO admins (school_id, first_name, last_name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [schoolId, admin.firstName, admin.lastName, admin.email, admin.phone, passwordHash]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'School registered successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Error registering school' });
  } finally {
    client.release();
  }
};
