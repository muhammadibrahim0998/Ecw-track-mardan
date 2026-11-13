import pool from './config/mysql.js';
async function test() {
  const [rows] = await pool.query('SHOW TABLES LIKE "%vendor_payment_ledger%"');
  console.log('Vendor ledger tables:', rows);
  process.exit(0);
}
test();
