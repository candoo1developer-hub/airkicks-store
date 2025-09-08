class Product {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description;
    this.price = data.price;
    this.category = data.category;
    this.sku = data.sku;
    this.imageUrl = data.image_url;
    this.stock = data.stock;
    this.features = data.features;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }
  
  static async findAll(pool) {
    const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    return result.rows.map(row => new Product(row));
  }
  
  static async findById(pool, id) {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    return result.rows[0] ? new Product(result.rows[0]) : null;
  }
  
  static async findByCategory(pool, category) {
    const result = await pool.query('SELECT * FROM products WHERE category = $1', [category]);
    return result.rows.map(row => new Product(row));
  }
  
  async save(pool) {
    if (this.id) {
      await pool.query(
        'UPDATE products SET name = $1, description = $2, price = $3, stock = $4 WHERE id = $5',
        [this.name, this.description, this.price, this.stock, this.id]
      );
    } else {
      const result = await pool.query(
        'INSERT INTO products (name, description, price, category, sku, image_url, stock, features) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [this.name, this.description, this.price, this.category, this.sku, this.imageUrl, this.stock, this.features]
      );
      this.id = result.rows[0].id;
    }
  }
}

module.exports = Product;