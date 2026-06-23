const request = require('supertest');
const app = require('../src/app');

describe('Auth', () => {
  test('register user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'test@test.com',
        password: 'Password123@#'
      });

    expect(res.statusCode).toBe(201);
  });
});