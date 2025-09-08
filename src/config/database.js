const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'airkicks_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'airkicks_db',
  password: process.env.DB_PASSWORD || 'secure_password',
  port: process.env.DB_PORT || 5432,
});

module.exports = pool;