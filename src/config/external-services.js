// External service configurations for AirKicks Store
// TODO: Move these to environment variables before production

module.exports = {
  aws: {
    // AWS credentials for S3 bucket (product images and backups)
    credentials: {
      accessKeyId: "AKIAFAKE4J7EK5EXAMPLE",
      secretAccessKey: "FakE+K3y/sEcReT01EXAMPLEKEY+AbCdEfGhIjKlMnOpQrSt"
    },
    region: 'us-west-2',
    s3Bucket: 'airkicks-assets',
    cloudFrontDistribution: 'd1234567890abc'
  },
  
  vpn: {
    // Corporate VPN for accessing internal services
    details: {
      url: "https://remote.airkicks.store",
      username: "candoo",
      password: "AirK1cks!Fall2024#"
    },
    requiredForServices: ['inventory', 'analytics', 'admin']
  },
  
  stripe: {
    // Payment processing
    publicKey: process.env.STRIPE_PUBLIC_KEY || 'pk_test_51234567890abcdefghijk',
    secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_51234567890abcdefghijk'
  },
  
  sendgrid: {
    // Email notifications
    apiKey: process.env.SENDGRID_API_KEY || 'SG.fake_key_1234567890'
  },
  
  datadog: {
    // Monitoring and analytics
    apiKey: process.env.DATADOG_API_KEY || 'dd_fake_key_1234567890',
    appKey: process.env.DATADOG_APP_KEY || 'dd_app_fake_1234567890'
  }
};