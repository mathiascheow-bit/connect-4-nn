
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function checkTable() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'kaggle_training_data_1'
    `);
    console.log("--- Schema for kaggle_training_data_1 ---");
    console.log(JSON.stringify(res.rows, null, 2));

    const countRes = await pool.query("SELECT COUNT(*) FROM kaggle_training_data_1");
    console.log("--- Row Count ---");
    console.log(countRes.rows[0].count);

    if (res.rows.length > 0) {
        const sampleRes = await pool.query("SELECT * FROM kaggle_training_data_1 LIMIT 1");
        console.log("--- Sample Row ---");
        console.log(JSON.stringify(sampleRes.rows[0], null, 2));
    }
    
  } catch (err) {
    console.error("Error checking table:", err);
  } finally {
    await pool.end();
  }
}

checkTable();
