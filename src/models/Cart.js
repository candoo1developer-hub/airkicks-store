const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  size: {
    type: String,
    trim: true
  },
  color: {
    type: String,
    trim: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0
  }
}, {
  timestamps: true
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  items: [cartItemSchema],
  totalItems: {
    type: Number,
    default: 0,
    min: 0
  },
  totalPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true
  },
  lastModified: {
    type: Date,
    default: Date.now
  },
  sessionId: {
    type: String,
    sparse: true
  },
  guestId: {
    type: String,
    sparse: true
  }
}, {
  timestamps: true
});

// Index for better query performance
cartSchema.index({ user: 1 });
cartSchema.index({ sessionId: 1 });
cartSchema.index({ guestId: 1 });
cartSchema.index({ lastModified: 1 });

// Virtual for cart expiry (30 days)
cartSchema.virtual('isExpired').get(function() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return this.lastModified < thirtyDaysAgo;
});

// Pre-save middleware to calculate totals
cartSchema.pre('save', function(next) {
  this.totalItems = this.items.reduce((total, item) => total + item.quantity, 0);
  this.totalPrice = this.items.reduce((total, item) => total + item.subtotal, 0);
  this.lastModified = new Date();
  next();
});

// Static method to find or create cart
cartSchema.statics.findOrCreateForUser = async function(userId) {
  let cart = await this.findOne({ user: userId }).populate('items.product');
  
  if (!cart) {
    cart = new this({ user: userId });
    await cart.save();
  }
  
  return cart;
};

// Instance method to add item
cartSchema.methods.addItem = function(productData) {
  const { product, quantity = 1, size, color, price } = productData;
  
  // Check if item already exists with same product, size, and color
  const existingItemIndex = this.items.findIndex(item => 
    item.product.toString() === product.toString() &&
    item.size === size &&
    item.color === color
  );
  
  if (existingItemIndex > -1) {
    // Update existing item
    this.items[existingItemIndex].quantity += quantity;
    this.items[existingItemIndex].subtotal = 
      this.items[existingItemIndex].quantity * this.items[existingItemIndex].price;
  } else {
    // Add new item
    const subtotal = quantity * price;
    this.items.push({
      product,
      quantity,
      size,
      color,
      price,
      subtotal
    });
  }
  
  return this.save();
};

// Instance method to remove item
cartSchema.methods.removeItem = function(itemId) {
  this.items.id(itemId).remove();
  return this.save();
};

// Instance method to update item quantity
cartSchema.methods.updateItemQuantity = function(itemId, quantity) {
  const item = this.items.id(itemId);
  if (item) {
    item.quantity = quantity;
    item.subtotal = quantity * item.price;
  }
  return this.save();
};

// Instance method to clear cart
cartSchema.methods.clearCart = function() {
  this.items = [];
  return this.save();
};

// Instance method to check if item is available
cartSchema.methods.validateItems = async function() {
  await this.populate('items.product');
  
  const invalidItems = [];
  
  for (let i = this.items.length - 1; i >= 0; i--) {
    const item = this.items[i];
    
    if (!item.product || !item.product.isActive) {
      invalidItems.push(item);
      this.items.splice(i, 1);
    } else if (item.product.stock < item.quantity) {
      item.quantity = Math.min(item.quantity, item.product.stock);
      item.subtotal = item.quantity * item.price;
      
      if (item.quantity === 0) {
        invalidItems.push(item);
        this.items.splice(i, 1);
      }
    }
  }
  
  if (invalidItems.length > 0) {
    await this.save();
  }
  
  return invalidItems;
};

module.exports = mongoose.model('Cart', cartSchema);