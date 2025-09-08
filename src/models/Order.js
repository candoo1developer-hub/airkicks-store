const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  street: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    required: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  zipCode: {
    type: String,
    required: true,
    trim: true
  },
  country: {
    type: String,
    required: true,
    trim: true,
    default: 'US'
  },
  phone: {
    type: String,
    trim: true
  }
});

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productSnapshot: {
    name: String,
    brand: String,
    category: String,
    images: [String],
    description: String
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  size: {
    type: String,
    trim: true
  },
  color: {
    type: String,
    trim: true
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
    default: 'pending'
  },
  trackingNumber: {
    type: String,
    trim: true
  }
});

const paymentSchema = new mongoose.Schema({
  method: {
    type: String,
    enum: ['credit_card', 'debit_card', 'paypal', 'stripe', 'apple_pay', 'google_pay'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending'
  },
  transactionId: {
    type: String,
    trim: true
  },
  gatewayResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true
  },
  processedAt: Date,
  refundedAt: Date,
  refundAmount: {
    type: Number,
    default: 0,
    min: 0
  }
});

const shippingSchema = new mongoose.Schema({
  method: {
    type: String,
    enum: ['standard', 'express', 'overnight', 'pickup'],
    default: 'standard'
  },
  cost: {
    type: Number,
    required: true,
    min: 0
  },
  estimatedDays: {
    type: Number,
    min: 1
  },
  carrier: {
    type: String,
    enum: ['ups', 'fedex', 'usps', 'dhl'],
    trim: true
  },
  trackingNumber: {
    type: String,
    trim: true
  },
  trackingUrl: {
    type: String,
    trim: true
  },
  shippedAt: Date,
  estimatedDelivery: Date,
  actualDelivery: Date
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  
  // Pricing
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  taxRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  discountCode: {
    type: String,
    trim: true
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true
  },
  
  // Addresses
  shippingAddress: {
    type: addressSchema,
    required: true
  },
  billingAddress: {
    type: addressSchema,
    required: true
  },
  
  // Payment and shipping
  payment: paymentSchema,
  shipping: shippingSchema,
  
  // Timestamps
  placedAt: {
    type: Date,
    default: Date.now
  },
  confirmedAt: Date,
  shippedAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  
  // Additional fields
  notes: {
    type: String,
    trim: true
  },
  customerNotes: {
    type: String,
    trim: true
  },
  internalNotes: {
    type: String,
    trim: true
  },
  
  // Analytics
  source: {
    type: String,
    enum: ['web', 'mobile', 'api', 'admin'],
    default: 'web'
  },
  referrer: {
    type: String,
    trim: true
  },
  ipAddress: {
    type: String,
    trim: true
  },
  userAgent: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ user: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ placedAt: -1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'payment.transactionId': 1 });
orderSchema.index({ 'shipping.trackingNumber': 1 });

// Compound indexes
orderSchema.index({ user: 1, placedAt: -1 });
orderSchema.index({ status: 1, placedAt: -1 });

// Virtual for formatted order number
orderSchema.virtual('formattedOrderNumber').get(function() {
  return `AK-${this.orderNumber}`;
});

// Virtual for order age in days
orderSchema.virtual('ageInDays').get(function() {
  return Math.floor((Date.now() - this.placedAt) / (1000 * 60 * 60 * 24));
});

// Virtual for full customer name
orderSchema.virtual('customerName').get(function() {
  return `${this.shippingAddress.firstName} ${this.shippingAddress.lastName}`;
});

// Pre-save middleware to generate order number
orderSchema.pre('save', async function(next) {
  if (!this.orderNumber) {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    this.orderNumber = `${timestamp}${random}`;
  }
  
  // Calculate totals if not set
  if (this.items && this.items.length > 0) {
    this.subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
    
    if (!this.total) {
      this.total = this.subtotal + (this.shipping?.cost || 0) + (this.tax || 0) - (this.discount || 0);
    }
  }
  
  next();
});

// Static method to generate unique order number
orderSchema.statics.generateOrderNumber = async function() {
  let orderNumber;
  let isUnique = false;
  
  while (!isUnique) {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    orderNumber = `${timestamp}${random}`;
    
    const existingOrder = await this.findOne({ orderNumber });
    if (!existingOrder) {
      isUnique = true;
    }
  }
  
  return orderNumber;
};

// Instance method to update order status
orderSchema.methods.updateStatus = function(status, notes) {
  const now = new Date();
  const oldStatus = this.status;
  
  this.status = status;
  
  // Set appropriate timestamp based on status
  switch (status) {
    case 'confirmed':
      this.confirmedAt = now;
      break;
    case 'shipped':
      this.shippedAt = now;
      break;
    case 'delivered':
      this.deliveredAt = now;
      break;
    case 'cancelled':
      this.cancelledAt = now;
      break;
  }
  
  if (notes) {
    this.internalNotes = this.internalNotes 
      ? `${this.internalNotes}\n[${now.toISOString()}] Status changed from ${oldStatus} to ${status}: ${notes}`
      : `[${now.toISOString()}] Status changed from ${oldStatus} to ${status}: ${notes}`;
  }
  
  return this.save();
};

// Instance method to add tracking information
orderSchema.methods.addTracking = function(trackingNumber, carrier, trackingUrl) {
  this.shipping.trackingNumber = trackingNumber;
  this.shipping.carrier = carrier;
  this.shipping.trackingUrl = trackingUrl;
  
  return this.save();
};

// Instance method to calculate refund amount
orderSchema.methods.calculateRefund = function(items = null) {
  if (!items) {
    // Full refund
    return this.total;
  }
  
  // Partial refund for specific items
  const refundAmount = items.reduce((sum, itemId) => {
    const item = this.items.id(itemId);
    return sum + (item ? item.totalPrice : 0);
  }, 0);
  
  return refundAmount;
};

// Instance method to check if order can be cancelled
orderSchema.methods.canBeCancelled = function() {
  return ['pending', 'confirmed'].includes(this.status);
};

// Instance method to check if order can be returned
orderSchema.methods.canBeReturned = function() {
  if (this.status !== 'delivered' || !this.deliveredAt) {
    return false;
  }
  
  // Allow returns within 30 days of delivery
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return this.deliveredAt > thirtyDaysAgo;
};

module.exports = mongoose.model('Order', orderSchema);