const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../config/logger');
const { cache } = require('../config/cache');

class PaymentService {
  constructor() {
    this.supportedMethods = ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay'];
    this.currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
  }

  /**
   * Process payment using various methods
   */
  async processPayment({
    amount,
    currency = 'USD',
    paymentMethod,
    orderId,
    customerInfo,
    metadata = {}
  }) {
    try {
      // Validate input
      if (!this.supportedMethods.includes(paymentMethod)) {
        throw new Error(`Unsupported payment method: ${paymentMethod}`);
      }

      if (!this.currencies.includes(currency.toUpperCase())) {
        throw new Error(`Unsupported currency: ${currency}`);
      }

      // Convert amount to cents for Stripe
      const amountInCents = Math.round(amount * 100);

      let result;
      
      switch (paymentMethod) {
        case 'credit_card':
        case 'debit_card':
          result = await this.processStripePayment({
            amount: amountInCents,
            currency: currency.toLowerCase(),
            orderId,
            customerInfo,
            metadata
          });
          break;
          
        case 'paypal':
          result = await this.processPayPalPayment({
            amount,
            currency,
            orderId,
            customerInfo,
            metadata
          });
          break;
          
        case 'apple_pay':
          result = await this.processApplePayPayment({
            amount: amountInCents,
            currency: currency.toLowerCase(),
            orderId,
            customerInfo,
            metadata
          });
          break;
          
        case 'google_pay':
          result = await this.processGooglePayPayment({
            amount: amountInCents,
            currency: currency.toLowerCase(),
            orderId,
            customerInfo,
            metadata
          });
          break;
          
        default:
          throw new Error(`Payment method ${paymentMethod} not implemented`);
      }

      // Log successful payment
      logger.info(`Payment processed successfully`, {
        orderId,
        transactionId: result.transactionId,
        amount,
        currency,
        paymentMethod
      });

      return {
        success: true,
        transactionId: result.transactionId,
        gatewayResponse: result.gatewayResponse,
        fees: result.fees || 0,
        netAmount: amount - (result.fees || 0)
      };

    } catch (error) {
      logger.error('Payment processing failed:', error);
      
      return {
        success: false,
        error: error.message,
        code: error.code,
        declineCode: error.decline_code
      };
    }
  }

  /**
   * Process Stripe payment
   */
  async processStripePayment({ amount, currency, orderId, customerInfo, metadata }) {
    try {
      // Create or retrieve customer
      const customer = await this.getOrCreateStripeCustomer(customerInfo);
      
      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency,
        customer: customer.id,
        description: `Order ${orderId}`,
        metadata: {
          orderId: orderId.toString(),
          ...metadata
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      // Simulate payment confirmation for development
      if (process.env.NODE_ENV === 'development') {
        await stripe.paymentIntents.confirm(paymentIntent.id, {
          payment_method: 'pm_card_visa', // Test payment method
        });
      }

      return {
        transactionId: paymentIntent.id,
        gatewayResponse: paymentIntent,
        fees: this.calculateStripeFees(amount / 100), // Convert back to dollars
        status: paymentIntent.status
      };

    } catch (error) {
      throw new Error(`Stripe payment failed: ${error.message}`);
    }
  }

  /**
   * Process PayPal payment (stub implementation)
   */
  async processPayPalPayment({ amount, currency, orderId, customerInfo, metadata }) {
    // This is a stub implementation
    // In production, you would integrate with PayPal SDK
    
    try {
      // Simulate PayPal API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Generate mock transaction ID
      const transactionId = `PP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        transactionId,
        gatewayResponse: {
          id: transactionId,
          status: 'COMPLETED',
          amount: { value: amount.toString(), currency_code: currency },
          payer: { email_address: customerInfo.email }
        },
        fees: this.calculatePayPalFees(amount),
        status: 'completed'
      };

    } catch (error) {
      throw new Error(`PayPal payment failed: ${error.message}`);
    }
  }

  /**
   * Process Apple Pay payment
   */
  async processApplePayPayment({ amount, currency, orderId, customerInfo, metadata }) {
    try {
      // Apple Pay is processed through Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency,
        description: `Order ${orderId}`,
        metadata: {
          orderId: orderId.toString(),
          paymentMethod: 'apple_pay',
          ...metadata
        },
        payment_method_types: ['card'],
      });

      return {
        transactionId: paymentIntent.id,
        gatewayResponse: paymentIntent,
        fees: this.calculateStripeFees(amount / 100),
        status: paymentIntent.status
      };

    } catch (error) {
      throw new Error(`Apple Pay payment failed: ${error.message}`);
    }
  }

  /**
   * Process Google Pay payment
   */
  async processGooglePayPayment({ amount, currency, orderId, customerInfo, metadata }) {
    try {
      // Google Pay is processed through Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency,
        description: `Order ${orderId}`,
        metadata: {
          orderId: orderId.toString(),
          paymentMethod: 'google_pay',
          ...metadata
        },
        payment_method_types: ['card'],
      });

      return {
        transactionId: paymentIntent.id,
        gatewayResponse: paymentIntent,
        fees: this.calculateStripeFees(amount / 100),
        status: paymentIntent.status
      };

    } catch (error) {
      throw new Error(`Google Pay payment failed: ${error.message}`);
    }
  }

  /**
   * Get or create Stripe customer
   */
  async getOrCreateStripeCustomer(customerInfo) {
    const cacheKey = `stripe_customer:${customerInfo.email}`;
    
    try {
      // Try to get from cache first
      const cachedCustomer = await cache.get(cacheKey);
      if (cachedCustomer) {
        return JSON.parse(cachedCustomer);
      }

      // Search for existing customer
      const existingCustomers = await stripe.customers.list({
        email: customerInfo.email,
        limit: 1
      });

      let customer;
      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
      } else {
        // Create new customer
        customer = await stripe.customers.create({
          email: customerInfo.email,
          name: customerInfo.name,
          address: {
            line1: customerInfo.address?.street,
            city: customerInfo.address?.city,
            state: customerInfo.address?.state,
            postal_code: customerInfo.address?.zipCode,
            country: customerInfo.address?.country || 'US'
          },
          metadata: {
            source: 'airkicks_store'
          }
        });
      }

      // Cache customer for 1 hour
      await cache.setex(cacheKey, 3600, JSON.stringify(customer));

      return customer;

    } catch (error) {
      logger.error('Error managing Stripe customer:', error);
      throw error;
    }
  }

  /**
   * Process refund
   */
  async processRefund({ transactionId, amount, reason = 'requested_by_customer' }) {
    try {
      // Determine payment method from transaction ID
      if (transactionId.startsWith('pi_')) {
        // Stripe payment
        const refund = await stripe.refunds.create({
          payment_intent: transactionId,
          amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents if partial refund
          reason
        });

        return {
          success: true,
          refundId: refund.id,
          amount: refund.amount / 100, // Convert back to dollars
          status: refund.status
        };

      } else if (transactionId.startsWith('PP_')) {
        // PayPal refund (stub)
        return {
          success: true,
          refundId: `REF_${Date.now()}`,
          amount: amount,
          status: 'completed'
        };
      }

      throw new Error('Unsupported transaction type for refund');

    } catch (error) {
      logger.error('Refund processing failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload, signature, endpointSecret) {
    try {
      return stripe.webhooks.constructEvent(payload, signature, endpointSecret);
    } catch (error) {
      logger.error('Webhook signature verification failed:', error);
      throw new Error('Invalid webhook signature');
    }
  }

  /**
   * Calculate Stripe fees (2.9% + $0.30 for US cards)
   */
  calculateStripeFees(amount) {
    return Math.round((amount * 0.029 + 0.30) * 100) / 100;
  }

  /**
   * Calculate PayPal fees (2.9% + $0.30 for US transactions)
   */
  calculatePayPalFees(amount) {
    return Math.round((amount * 0.029 + 0.30) * 100) / 100;
  }

  /**
   * Get supported payment methods for a country
   */
  getSupportedPaymentMethods(country = 'US') {
    const methods = {
      US: ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay'],
      CA: ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay'],
      GB: ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay'],
      EU: ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay']
    };

    return methods[country] || methods.US;
  }

  /**
   * Validate payment method for country
   */
  isPaymentMethodSupported(paymentMethod, country = 'US') {
    const supportedMethods = this.getSupportedPaymentMethods(country);
    return supportedMethods.includes(paymentMethod);
  }
}

// Export singleton instance
module.exports = new PaymentService();