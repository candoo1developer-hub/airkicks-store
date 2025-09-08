const Cart = require('../models/Cart');
const Product = require('../models/Product');
const logger = require('../config/logger');
const { cache } = require('../config/cache');

/**
 * Get user's shopping cart
 */
const getCart = async (req, res) => {
  try {
    const cacheKey = `cart:${req.user.id}`;
    
    // Try to get from cache first
    const cachedCart = await cache.get(cacheKey);
    if (cachedCart) {
      return res.json({
        success: true,
        cart: JSON.parse(cachedCart)
      });
    }
    
    const cart = await Cart.findOrCreateForUser(req.user.id)
      .populate('items.product', 'name price images brand category stock isActive');
    
    // Validate cart items and remove unavailable products
    const invalidItems = await cart.validateItems();
    
    if (invalidItems.length > 0) {
      logger.info(`Removed ${invalidItems.length} invalid items from cart for user ${req.user.id}`);
    }
    
    // Cache the cart for 10 minutes
    await cache.setex(cacheKey, 600, JSON.stringify(cart));
    
    res.json({
      success: true,
      cart,
      removedItems: invalidItems
    });
  } catch (error) {
    logger.error('Error getting cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cart'
    });
  }
};

/**
 * Add item to cart
 */
const addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1, size, color } = req.body;
    
    // Verify product exists and is available
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or unavailable'
      });
    }
    
    // Check stock availability
    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient stock',
        availableStock: product.stock
      });
    }
    
    const cart = await Cart.findOrCreateForUser(req.user.id);
    
    await cart.addItem({
      product: productId,
      quantity,
      size,
      color,
      price: product.price
    });
    
    // Clear cache
    await cache.del(`cart:${req.user.id}`);
    
    // Populate the cart for response
    await cart.populate('items.product', 'name price images brand category');
    
    logger.info(`User ${req.user.id} added product ${productId} to cart`);
    
    res.status(201).json({
      success: true,
      message: 'Item added to cart',
      cart
    });
  } catch (error) {
    logger.error('Error adding to cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add item to cart'
    });
  }
};

/**
 * Update cart item quantity
 */
const updateCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;
    
    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }
    
    const item = cart.items.id(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    // Check stock availability
    const product = await Product.findById(item.product);
    if (!product || product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient stock',
        availableStock: product ? product.stock : 0
      });
    }
    
    await cart.updateItemQuantity(itemId, quantity);
    
    // Clear cache
    await cache.del(`cart:${req.user.id}`);
    
    // Populate the cart for response
    await cart.populate('items.product', 'name price images brand category');
    
    logger.info(`User ${req.user.id} updated cart item ${itemId} quantity to ${quantity}`);
    
    res.json({
      success: true,
      message: 'Cart item updated',
      cart
    });
  } catch (error) {
    logger.error('Error updating cart item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update cart item'
    });
  }
};

/**
 * Remove item from cart
 */
const removeFromCart = async (req, res) => {
  try {
    const { itemId } = req.params;
    
    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }
    
    const item = cart.items.id(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    await cart.removeItem(itemId);
    
    // Clear cache
    await cache.del(`cart:${req.user.id}`);
    
    logger.info(`User ${req.user.id} removed cart item ${itemId}`);
    
    res.json({
      success: true,
      message: 'Item removed from cart',
      cart
    });
  } catch (error) {
    logger.error('Error removing from cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item from cart'
    });
  }
};

/**
 * Clear all items from cart
 */
const clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }
    
    await cart.clearCart();
    
    // Clear cache
    await cache.del(`cart:${req.user.id}`);
    
    logger.info(`User ${req.user.id} cleared cart`);
    
    res.json({
      success: true,
      message: 'Cart cleared',
      cart
    });
  } catch (error) {
    logger.error('Error clearing cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cart'
    });
  }
};

/**
 * Get cart items count
 */
const getCartCount = async (req, res) => {
  try {
    const cacheKey = `cart_count:${req.user.id}`;
    
    // Try to get from cache first
    const cachedCount = await cache.get(cacheKey);
    if (cachedCount !== null) {
      return res.json({
        success: true,
        count: parseInt(cachedCount)
      });
    }
    
    const cart = await Cart.findOne({ user: req.user.id });
    const count = cart ? cart.totalItems : 0;
    
    // Cache for 5 minutes
    await cache.setex(cacheKey, 300, count.toString());
    
    res.json({
      success: true,
      count
    });
  } catch (error) {
    logger.error('Error getting cart count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cart count'
    });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  getCartCount
};