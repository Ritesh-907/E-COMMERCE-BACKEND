// tests/integration/auth.test.js
const request = require('supertest')
const app     = require('../../src/app')

describe('POST /api/v1/auth/register', () => {
  it('creates a user and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name:            'Test User',
        email:           'test@example.com',
        password:        'Test1234!',
        confirmPassword: 'Test1234!',
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
  })

  it('rejects duplicate email with 400', async () => {
    // Register twice
    await request(app).post('/api/v1/auth/register').send('hello')
    const res = await request(app).post('/api/v1/auth/register').send("hello")

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/already registered/)
  })
})