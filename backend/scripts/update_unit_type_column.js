import pool from '../config/mysql.js';

async function updateUnitTypes() {
  try {
    const [tables] = await pool.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND COLUMN_NAME = 'unitType' 
        AND TABLE_NAME LIKE '%_items';
    `);

    for (const row of tables) {
      const t = row.TABLE_NAME;
      console.log(`Modifying unitType in ${t}...`);
      await pool.query(`ALTER TABLE \`${t}\` MODIFY COLUMN \`unitType\` VARCHAR(100) DEFAULT 'Premium'`);
    }

    // Fix item 116 and 115 in peshawar_branch__items
    await pool.query(`UPDATE peshawar_branch__items SET unitType = 'Premium Pro' WHERE id = 116`);
    await pool.query(`UPDATE peshawar_branch__items SET unitType = 'Premium' WHERE id = 115`);

    console.log('✅ All item tables unitType column converted to VARCHAR(100)!');
    process.exit(0);
  } catch (err) {
    console.error('Error updating unit types:', err);
    process.exit(1);
  }
}

updateUnitTypes();

