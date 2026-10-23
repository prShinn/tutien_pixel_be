const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? '' : 'local-only-change-me');
if (!jwtSecret) throw new Error('JWT_SECRET is required in production');

module.exports = {
  port: Number(process.env.PORT || 3000),
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  isProduction,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'tu_tien_pixel',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  },
};
