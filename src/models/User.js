class User {
  constructor(data) {
    this.id = data.id;
    this.email = data.email;
    this.firstName = data.first_name;
    this.lastName = data.last_name;
    this.role = data.role || 'customer';
    this.createdAt = data.created_at;
    this.lastLogin = data.last_login;
  }
  
  static async findById(pool, id) {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, role, created_at, last_login FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] ? new User(result.rows[0]) : null;
  }
  
  static async findByEmail(pool, email) {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, role, created_at, last_login FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] ? new User(result.rows[0]) : null;
  }
  
  async updateLastLogin(pool) {
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [this.id]);
  }
}

module.exports = User;