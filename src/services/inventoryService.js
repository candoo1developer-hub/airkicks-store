const Product = require('../models/Product');
const logger = require('../config/logger');
const { cache } = require('../config/cache');
const { EventEmitter } = require('events');

class InventoryService extends EventEmitter {
  constructor() {
    super();
    this.lowStockThreshold = 10;
    this.outOfStockThreshold = 0;
    this.reservations = new Map(); // In-memory reservations for cart items
  }

  /**
   * Check product availability
   */
  async checkAvailability(productId, quantity = 1, options = {}) {
    try {
      const { size, color } = options;
      const cacheKey = `inventory:${productId}:${size || 'any'}:${color || 'any'}`;
      
      // Try cache first
      const cachedStock = await cache.get(cacheKey);
      if (cachedStock !== null) {
        const stock = parseInt(cachedStock);
        return {
          available: stock >= quantity,
          stock,
          requested: quantity,
          canFulfill: stock
        };
      }

      const product = await Product.findById(productId);
      if (!product || !product.isActive) {
        return {
          available: false,
          stock: 0,
          requested: quantity,
          canFulfill: 0,
          reason: 'Product not found or inactive'
        };
      }

      let availableStock = product.stock;

      // Check variant-specific stock if size/color specified
      if (size || color) {
        const variant = product.variants?.find(v => 
          (!size || v.size === size) && (!color || v.color === color)
        );
        
        if (variant) {
          availableStock = variant.stock || 0;
        } else {
          return {
            available: false,
            stock: 0,
            requested: quantity,
            canFulfill: 0,
            reason: 'Variant not found'
          };
        }
      }

      // Check reserved stock
      const reservedStock = this.getReservedStock(productId, { size, color });
      const actualAvailable = Math.max(0, availableStock - reservedStock);

      // Cache the result for 5 minutes
      await cache.setex(cacheKey, 300, actualAvailable.toString());

      return {
        available: actualAvailable >= quantity,
        stock: actualAvailable,
        requested: quantity,
        canFulfill: Math.min(actualAvailable, quantity),
        reserved: reservedStock
      };

    } catch (error) {
      logger.error('Error checking availability:', error);
      throw error;
    }
  }

  /**
   * Reserve stock for cart items
   */
  async reserveStock(productId, quantity, options = {}, reservationId) {
    try {
      const { size, color, ttl = 900 } = options; // 15 minutes default TTL
      
      // Check availability first
      const availability = await this.checkAvailability(productId, quantity, { size, color });
      if (!availability.available) {
        throw new Error(`Insufficient stock. Available: ${availability.stock}, Requested: ${quantity}`);
      }

      const reservationKey = `${productId}:${size || 'any'}:${color || 'any'}`;
      
      if (!this.reservations.has(reservationKey)) {
        this.reservations.set(reservationKey, new Map());
      }

      const productReservations = this.reservations.get(reservationKey);
      productReservations.set(reservationId, {
        quantity,
        createdAt: Date.now(),
        ttl: ttl * 1000 // Convert to milliseconds
      });

      // Set cleanup timer
      setTimeout(() => {
        this.releaseReservation(reservationId, productId, { size, color });
      }, ttl * 1000);

      logger.info(`Reserved ${quantity} units of product ${productId}`, {
        reservationId,
        size,
        color,
        ttl
      });

      // Invalidate cache
      const cacheKey = `inventory:${productId}:${size || 'any'}:${color || 'any'}`;
      await cache.del(cacheKey);

      this.emit('stockReserved', {
        productId,
        quantity,
        reservationId,
        size,
        color
      });

      return {
        success: true,
        reservationId,
        quantity,
        expiresAt: Date.now() + (ttl * 1000)
      };

    } catch (error) {
      logger.error('Error reserving stock:', error);
      throw error;
    }
  }

  /**
   * Release stock reservation
   */
  async releaseReservation(reservationId, productId, options = {}) {
    try {
      const { size, color } = options;
      const reservationKey = `${productId}:${size || 'any'}:${color || 'any'}`;
      
      const productReservations = this.reservations.get(reservationKey);
      if (!productReservations || !productReservations.has(reservationId)) {
        return { success: false, reason: 'Reservation not found' };
      }

      const reservation = productReservations.get(reservationId);
      productReservations.delete(reservationId);

      // Clean up empty maps
      if (productReservations.size === 0) {
        this.reservations.delete(reservationKey);
      }

      logger.info(`Released reservation ${reservationId} for product ${productId}`, {
        quantity: reservation.quantity,
        size,
        color
      });

      // Invalidate cache
      const cacheKey = `inventory:${productId}:${size || 'any'}:${color || 'any'}`;
      await cache.del(cacheKey);

      this.emit('stockReleased', {
        productId,
        quantity: reservation.quantity,
        reservationId,
        size,
        color
      });

      return {
        success: true,
        quantity: reservation.quantity
      };

    } catch (error) {
      logger.error('Error releasing reservation:', error);
      throw error;
    }
  }

  /**
   * Update stock levels
   */
  async updateStock(productId, quantity, operation = 'set', options = {}) {
    try {
      const { size, color, reason = 'Manual update' } = options;
      
      const product = await Product.findById(productId);
      if (!product) {
        throw new Error('Product not found');
      }

      let oldStock, newStock;

      if (size || color) {
        // Update variant stock
        const variantIndex = product.variants?.findIndex(v => 
          (!size || v.size === size) && (!color || v.color === color)
        );

        if (variantIndex === -1) {
          throw new Error('Variant not found');
        }

        oldStock = product.variants[variantIndex].stock || 0;
        
        switch (operation) {
          case 'set':
            newStock = quantity;
            break;
          case 'add':
            newStock = oldStock + quantity;
            break;
          case 'subtract':
            newStock = Math.max(0, oldStock - quantity);
            break;
          default:
            throw new Error('Invalid operation');
        }

        product.variants[variantIndex].stock = newStock;
        
        // Update main product stock (sum of all variants)
        product.stock = product.variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
        
      } else {
        // Update main product stock
        oldStock = product.stock;
        
        switch (operation) {
          case 'set':
            newStock = quantity;
            break;
          case 'add':
            newStock = oldStock + quantity;
            break;
          case 'subtract':
            newStock = Math.max(0, oldStock - quantity);
            break;
          default:
            throw new Error('Invalid operation');
        }

        product.stock = newStock;
      }

      await product.save();

      // Log inventory change
      logger.info(`Stock updated for product ${productId}`, {
        operation,
        oldStock,
        newStock,
        quantity,
        size,
        color,
        reason
      });

      // Invalidate cache
      const cacheKey = `inventory:${productId}:${size || 'any'}:${color || 'any'}`;
      await cache.del(cacheKey);

      // Check for low stock alerts
      await this.checkStockAlerts(product, { size, color });

      this.emit('stockUpdated', {
        productId,
        oldStock,
        newStock,
        operation,
        quantity,
        size,
        color
      });

      return {
        success: true,
        oldStock,
        newStock,
        operation
      };

    } catch (error) {
      logger.error('Error updating stock:', error);
      throw error;
    }
  }

  /**
   * Get reserved stock for a product
   */
  getReservedStock(productId, options = {}) {
    const { size, color } = options;
    const reservationKey = `${productId}:${size || 'any'}:${color || 'any'}`;
    
    const productReservations = this.reservations.get(reservationKey);
    if (!productReservations) {
      return 0;
    }

    const now = Date.now();
    let totalReserved = 0;

    // Clean up expired reservations
    for (const [reservationId, reservation] of productReservations.entries()) {
      if (now > reservation.createdAt + reservation.ttl) {
        productReservations.delete(reservationId);
      } else {
        totalReserved += reservation.quantity;
      }
    }

    return totalReserved;
  }

  /**
   * Get low stock products
   */
  async getLowStockProducts(threshold = this.lowStockThreshold) {
    try {
      const lowStockProducts = await Product.find({
        stock: { $lte: threshold },
        isActive: true
      }).select('name brand stock category price');

      return lowStockProducts;

    } catch (error) {
      logger.error('Error getting low stock products:', error);
      throw error;
    }
  }

  /**
   * Get out of stock products
   */
  async getOutOfStockProducts() {
    try {
      const outOfStockProducts = await Product.find({
        stock: { $lte: this.outOfStockThreshold },
        isActive: true
      }).select('name brand stock category price');

      return outOfStockProducts;

    } catch (error) {
      logger.error('Error getting out of stock products:', error);
      throw error;
    }
  }

  /**
   * Check and emit stock alerts
   */
  async checkStockAlerts(product, options = {}) {
    const { size, color } = options;
    
    let currentStock;
    if (size || color) {
      const variant = product.variants?.find(v => 
        (!size || v.size === size) && (!color || v.color === color)
      );
      currentStock = variant?.stock || 0;
    } else {
      currentStock = product.stock;
    }

    if (currentStock <= this.outOfStockThreshold) {
      this.emit('outOfStock', {
        productId: product._id,
        productName: product.name,
        stock: currentStock,
        size,
        color
      });
    } else if (currentStock <= this.lowStockThreshold) {
      this.emit('lowStock', {
        productId: product._id,
        productName: product.name,
        stock: currentStock,
        threshold: this.lowStockThreshold,
        size,
        color
      });
    }
  }

  /**
   * Batch update stock levels
   */
  async batchUpdateStock(updates) {
    const results = [];
    
    for (const update of updates) {
      try {
        const result = await this.updateStock(
          update.productId,
          update.quantity,
          update.operation || 'set',
          update.options || {}
        );
        results.push({ ...result, productId: update.productId });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          productId: update.productId
        });
      }
    }

    return results;
  }

  /**
   * Generate inventory report
   */
  async generateInventoryReport() {
    try {
      const [
        totalProducts,
        activeProducts,
        lowStockProducts,
        outOfStockProducts,
        totalValue
      ] = await Promise.all([
        Product.countDocuments(),
        Product.countDocuments({ isActive: true }),
        this.getLowStockProducts(),
        this.getOutOfStockProducts(),
        Product.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: null, totalValue: { $sum: { $multiply: ['$stock', '$price'] } } } }
        ])
      ]);

      const report = {
        summary: {
          totalProducts,
          activeProducts,
          lowStockCount: lowStockProducts.length,
          outOfStockCount: outOfStockProducts.length,
          totalInventoryValue: totalValue[0]?.totalValue || 0
        },
        lowStockProducts,
        outOfStockProducts,
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      logger.error('Error generating inventory report:', error);
      throw error;
    }
  }

  /**
   * Cleanup expired reservations
   */
  cleanupExpiredReservations() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [reservationKey, productReservations] of this.reservations.entries()) {
      for (const [reservationId, reservation] of productReservations.entries()) {
        if (now > reservation.createdAt + reservation.ttl) {
          productReservations.delete(reservationId);
          cleanedCount++;
        }
      }
      
      // Remove empty maps
      if (productReservations.size === 0) {
        this.reservations.delete(reservationKey);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired reservations`);
    }
  }
}

// Create singleton instance
const inventoryService = new InventoryService();

// Set up periodic cleanup of expired reservations (every 5 minutes)
setInterval(() => {
  inventoryService.cleanupExpiredReservations();
}, 5 * 60 * 1000);

// Set up stock alerts
inventoryService.on('lowStock', (data) => {
  logger.warn('Low stock alert:', data);
  // TODO: Send notification to admins
});

inventoryService.on('outOfStock', (data) => {
  logger.error('Out of stock alert:', data);
  // TODO: Send urgent notification to admins
});

module.exports = inventoryService;