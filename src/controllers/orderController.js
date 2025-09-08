const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const logger = require('../config/logger');
const { cache } = require('../config/cache');
const { sendEmail } = require('../services/emailService');
const { calculateShipping } = require('../services/shippingService');
const { calculateTax } = require('../services/taxService');
const { processPayment } = require('../services/paymentService');

/**
 * Create a new order from user's cart
 */
const createOrder = async (req, res) => {
  try {
    const { shippingAddress, billingAddress, paymentMethod, shippingMethod, discountCode, customerNotes } = req.body;
    const userId = req.user.id;
    
    // Get user's cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }
    
    // Validate all items are still available
    const invalidItems = await cart.validateItems();
    if (invalidItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some items in your cart are no longer available',
        invalidItems
      });
    }
    
    // Calculate pricing
    const subtotal = cart.totalPrice;
    const shipping = await calculateShipping(shippingAddress, shippingMethod, cart.items);
    const tax = await calculateTax(subtotal, shippingAddress);
    
    // Apply discount if provided
    let discount = 0;
    if (discountCode) {
      // TODO: Implement discount code validation
      discount = 0; // Placeholder
    }
    
    const total = subtotal + shipping.cost + tax.amount - discount;
    
    // Create order items with product snapshots
    const orderItems = cart.items.map(item => ({
      product: item.product._id,
      productSnapshot: {
        name: item.product.name,
        brand: item.product.brand,
        category: item.product.category,
        images: item.product.images,
        description: item.product.description
      },
      quantity: item.quantity,
      size: item.size,
      color: item.color,
      unitPrice: item.price,
      totalPrice: item.subtotal
    }));
    
    // Generate order number
    const orderNumber = await Order.generateOrderNumber();
    
    // Create order
    const order = new Order({
      orderNumber,
      user: userId,
      items: orderItems,
      subtotal,
      tax: tax.amount,
      taxRate: tax.rate,
      discount,
      discountCode,
      total,
      shippingAddress,
      billingAddress,
      payment: {
        method: paymentMethod,
        amount: total
      },
      shipping: {
        method: shippingMethod,
        cost: shipping.cost,
        estimatedDays: shipping.estimatedDays,
        carrier: shipping.carrier
      },
      customerNotes,
      source: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'web',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    await order.save();
    
    // Process payment
    const paymentResult = await processPayment({
      amount: total,
      currency: order.currency,
      paymentMethod,
      orderId: order._id,
      customerInfo: {
        email: req.user.email,
        name: `${shippingAddress.firstName} ${shippingAddress.lastName}`,
        address: billingAddress
      }
    });
    
    if (!paymentResult.success) {
      order.payment.status = 'failed';
      order.status = 'cancelled';
      await order.save();
      
      return res.status(400).json({
        success: false,
        message: 'Payment processing failed',
        error: paymentResult.error
      });
    }
    
    // Update order with payment information
    order.payment.status = 'completed';
    order.payment.transactionId = paymentResult.transactionId;
    order.payment.processedAt = new Date();
    order.payment.gatewayResponse = paymentResult.gatewayResponse;
    order.status = 'confirmed';
    order.confirmedAt = new Date();
    
    await order.save();
    
    // Update product stock
    for (const item of cart.items) {
      await Product.findByIdAndUpdate(
        item.product._id,
        { $inc: { stock: -item.quantity } }
      );
    }
    
    // Clear user's cart
    await cart.clearCart();
    
    // Clear user's cart cache
    await cache.del(`cart:${userId}`);
    
    // Send order confirmation email
    try {
      await sendEmail({
        to: req.user.email,
        subject: `Order Confirmation - ${order.formattedOrderNumber}`,
        template: 'orderConfirmation',
        data: { order, user: req.user }
      });
    } catch (emailError) {
      logger.error('Failed to send order confirmation email:', emailError);
    }
    
    logger.info(`Order ${order.orderNumber} created for user ${userId}`);
    
    // Populate order for response
    await order.populate('user', 'firstName lastName email');
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order
    });
    
  } catch (error) {
    logger.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order'
    });
  }
};

/**
 * Get user's orders
 */
const getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;
    
    const query = { user: userId };
    if (status) {
      query.status = status;
    }
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { placedAt: -1 },
      populate: [
        { path: 'user', select: 'firstName lastName email' },
        { path: 'items.product', select: 'name brand images' }
      ]
    };
    
    const orders = await Order.paginate(query, options);
    
    res.json({
      success: true,
      orders: orders.docs,
      pagination: {
        page: orders.page,
        limit: orders.limit,
        total: orders.totalDocs,
        pages: orders.totalPages,
        hasNext: orders.hasNextPage,
        hasPrev: orders.hasPrevPage
      }
    });
  } catch (error) {
    logger.error('Error getting orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve orders'
    });
  }
};

/**
 * Get single order by ID
 */
const getOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('user', 'firstName lastName email')
      .populate('items.product', 'name brand images');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      order
    });
  } catch (error) {
    logger.error('Error getting order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve order'
    });
  }
};

/**
 * Cancel an order
 */
const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    
    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    if (!order.canBeCancelled()) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled at this stage'
      });
    }
    
    // Process refund if payment was completed
    if (order.payment.status === 'completed') {
      // TODO: Implement refund processing
      order.payment.status = 'refunded';
      order.payment.refundedAt = new Date();
      order.payment.refundAmount = order.total;
    }
    
    // Restore product stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: item.quantity } }
      );
    }
    
    await order.updateStatus('cancelled', reason || 'Cancelled by customer');
    
    // Send cancellation email
    try {
      await sendEmail({
        to: req.user.email,
        subject: `Order Cancelled - ${order.formattedOrderNumber}`,
        template: 'orderCancellation',
        data: { order, user: req.user, reason }
      });
    } catch (emailError) {
      logger.error('Failed to send order cancellation email:', emailError);
    }
    
    logger.info(`Order ${order.orderNumber} cancelled by user ${userId}`);
    
    res.json({
      success: true,
      message: 'Order cancelled successfully',
      order
    });
    
  } catch (error) {
    logger.error('Error cancelling order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order'
    });
  }
};

/**
 * Track order status
 */
const trackOrder = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    
    const order = await Order.findOne({ orderNumber })
      .select('orderNumber status placedAt confirmedAt shippedAt deliveredAt shipping items')
      .populate('items.product', 'name brand images');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Check if user owns this order
    if (req.user && order.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const trackingInfo = {
      orderNumber: order.formattedOrderNumber,
      status: order.status,
      timeline: [
        { status: 'placed', date: order.placedAt, completed: true },
        { status: 'confirmed', date: order.confirmedAt, completed: !!order.confirmedAt },
        { status: 'shipped', date: order.shippedAt, completed: !!order.shippedAt },
        { status: 'delivered', date: order.deliveredAt, completed: !!order.deliveredAt }
      ],
      shipping: order.shipping,
      estimatedDelivery: order.shipping?.estimatedDelivery,
      trackingUrl: order.shipping?.trackingUrl
    };
    
    res.json({
      success: true,
      tracking: trackingInfo
    });
    
  } catch (error) {
    logger.error('Error tracking order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track order'
    });
  }
};

/**
 * Request order return
 */
const requestReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason, items } = req.body;
    const userId = req.user.id;
    
    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    if (!order.canBeReturned()) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be returned. Return window may have expired.'
      });
    }
    
    // TODO: Implement return request processing
    // This would typically create a return request record
    
    logger.info(`Return requested for order ${order.orderNumber} by user ${userId}`);
    
    res.json({
      success: true,
      message: 'Return request submitted successfully'
    });
    
  } catch (error) {
    logger.error('Error requesting return:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit return request'
    });
  }
};

/**
 * Get order invoice/receipt
 */
const getInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('user', 'firstName lastName email')
      .populate('items.product', 'name brand');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // TODO: Generate PDF invoice
    // For now, return order data suitable for invoice generation
    
    const invoice = {
      orderNumber: order.formattedOrderNumber,
      date: order.placedAt,
      customer: {
        name: order.customerName,
        email: order.user.email,
        address: order.billingAddress
      },
      items: order.items.map(item => ({
        name: item.productSnapshot.name,
        brand: item.productSnapshot.brand,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice
      })),
      subtotal: order.subtotal,
      tax: order.tax,
      shipping: order.shipping.cost,
      discount: order.discount,
      total: order.total,
      paymentMethod: order.payment.method,
      shippingAddress: order.shippingAddress
    };
    
    res.json({
      success: true,
      invoice
    });
    
  } catch (error) {
    logger.error('Error getting invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve invoice'
    });
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrder,
  cancelOrder,
  trackOrder,
  requestReturn,
  getInvoice
};