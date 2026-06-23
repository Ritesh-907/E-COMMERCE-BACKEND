# Ecommerce Backend API

Production-ready REST API built with Node.js, Express, MongoDB, Redis, Socket.IO, and Stripe.

## Quick Start

```bash
cp .env.example .env      # Fill in your values
npm install
npm run seed              # Optional: seed sample data
npm run dev               # Start dev server with nodemon
```

## Scripts

| Command             | Description                        |
|---------------------|------------------------------------|
| `npm run dev`       | Development server (nodemon)       |
| `npm start`         | Production server                  |
| `npm test`          | Run Jest test suite                |
| `npm run seed`      | Seed database with sample data     |
| `npm run create-admin` | Create first admin user         |
| `npm run reset-db`  | Drop all collections (dev only)    |

## Tech Stack

- **Runtime**: Node.js + Express
- **Database**: MongoDB + Mongoose
- **Cache**: Redis (ioredis)
- **Auth**: JWT (access + refresh tokens) + Google OAuth
- **Payments**: Stripe
- **File Uploads**: Cloudinary / AWS S3
- **Email**: Nodemailer (SMTP)
- **Queue**: Bull (Redis-backed)
- **Realtime**: Socket.IO
- **Validation**: Joi
- **Logging**: Winston + Morgan

## Project Structure

See `/src` for all source files. Each file contains detailed comments explaining
what functions to implement, expected inputs/outputs, and implementation tips.

## API Base URL

`/api/v1`

## Auth Flow

1. Register → receive verification email
2. Verify email → account activated
3. Login → receive `accessToken` (body) + `refreshToken` (httpOnly cookie)
4. Use `Authorization: Bearer <accessToken>` on protected routes
5. On expiry → POST `/auth/refresh-token` → new access token
6. Logout → refresh token revoked, cookie cleared
