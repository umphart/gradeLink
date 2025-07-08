//utils/examUtils.js
function getGrade(total) {
  if (total >= 75) return 'A';
  if (total >= 65) return 'B';
  if (total >= 50) return 'C';
  if (total >= 45) return 'D';
  if (total >= 40) return 'E';
  return 'F';
}

function getRemark(grade) {
  const remarks = {
    A: 'Excellent',
    B: 'Very Good',
    C: 'Good',
    D: 'Fair',
    E: 'Pass',
    F: 'Fail'
  };
  return remarks[grade] || '';
}

async function updateAveragesAndPositions(schoolDb, tableName) {
  await schoolDb.query(`
    UPDATE ${tableName} SET average = sub.avg
    FROM (
      SELECT admission_number, AVG(total)::FLOAT as avg
      FROM ${tableName}
      GROUP BY admission_number
    ) AS sub
    WHERE ${tableName}.admission_number = sub.admission_number
  `);

  await schoolDb.query(`
    WITH ranked AS (
      SELECT admission_number, average,
             RANK() OVER (ORDER BY average DESC) as pos
      FROM (
        SELECT admission_number, AVG(total)::FLOAT AS average
        FROM ${tableName}
        GROUP BY admission_number
      ) sub
    )
    UPDATE ${tableName} AS t
    SET position = r.pos
    FROM ranked r
    WHERE t.admission_number = r.admission_number;
  `);
}

module.exports = {
  getGrade,
  getRemark,
  updateAveragesAndPositions
};
