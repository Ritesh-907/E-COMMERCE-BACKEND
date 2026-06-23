'use strict';

/**
 * docs/swagger.js — Swagger / OpenAPI Documentation Setup
 * =========================================================
 * Serves the complete openapi.yaml spec via Swagger UI.
 * Does NOT use swagger-jsdoc — we serve the hand-written YAML directly
 * so every endpoint is always visible and no @swagger JSDoc comments
 * are needed in route files.
 *
 * Endpoints:
 *   GET /api/v1/docs       — Swagger UI (development only)
 *   GET /api/v1/docs.json  — Raw OpenAPI spec as JSON (Postman/Insomnia)
 *   GET /api/v1/docs.yaml  — Raw OpenAPI spec as YAML
 *
 * Called once in app.js:
 *   const { setupSwagger } = require('./docs/swagger')
 *   setupSwagger(app)
 */

const path   = require('path');
const fs     = require('fs');
const YAML   = require('js-yaml');
const logger = require('../utils/logger');

// ── Load the spec from openapi.yaml (once at startup) ─────────────────────────

const YAML_PATH = path.join(__dirname, 'openapi.yaml');

let swaggerSpec;

try {
  const yamlContent = fs.readFileSync(YAML_PATH, 'utf8');
  swaggerSpec       = YAML.load(yamlContent);
} catch (err) {
  logger.warn('Failed to load openapi.yaml — Swagger UI will be empty', {
    error: err.message,
    path:  YAML_PATH,
  });
  // Fall back to a minimal spec so Swagger UI still loads
  swaggerSpec = {
    openapi: '3.0.0',
    info:    { title: 'E-Commerce API', version: '1.0.0' },
    paths:   {},
  };
}

// ── Swagger UI options ────────────────────────────────────────────────────────

const swaggerUiOptions = {
  // Override the default URL so Swagger UI reads our spec
  // (not the default petstore)
  swaggerOptions: {
    url:                  '/api/v1/docs.json',
    persistAuthorization: true,   // Keep Bearer token across page reloads
    docExpansion:         'list', // 'none' | 'list' | 'full'
    filter:               true,   // Show search/filter bar
    tryItOutEnabled:      true,   // Enable "Try it out" by default
    requestInterceptor: (request) => {
      // Ensure Content-Type is set for requests with a body
      if (request.body && !request.headers['Content-Type']) {
        request.headers['Content-Type'] = 'application/json';
      }
      return request;
    },
  },

  customSiteTitle: 'E-Commerce API Docs',

  customCss: `
    /* Topbar branding */
    .swagger-ui .topbar {
      background-color: #1a1a2e;
      padding: 8px 20px;
    }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .topbar-wrapper .link img    { display: none; }
    .swagger-ui .topbar-wrapper .link::after {
      content: '🛒 E-Commerce API';
      color: #fff;
      font-weight: bold;
      font-size: 1.1em;
      letter-spacing: 0.5px;
    }

    /* Tag section headers */
    .swagger-ui .opblock-tag {
      font-size: 1em;
      border-bottom: 1px solid #e8e8e8;
    }

    /* Make the try-it-out button more visible */
    .swagger-ui .try-out__btn {
      border-color: #49cc90;
      color: #49cc90;
    }
  `,
};

// ── setupSwagger ──────────────────────────────────────────────────────────────

/**
 * Mount Swagger UI and raw spec endpoints on the Express app.
 * Only active when NODE_ENV !== 'production'.
 *
 * @param {import('express').Application} app
 */
function setupSwagger(app) {
  if (process.env.NODE_ENV === 'production') return;

  const swaggerUi = require('swagger-ui-express');

  // ── GET /api/v1/docs.json — raw spec as JSON ──────────────────────────────
  // MUST be registered BEFORE swagger-ui-express so Swagger UI can fetch it
  app.get('/api/v1/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow Swagger UI to fetch it
    res.send(JSON.stringify(swaggerSpec, null, 2));
  });

  // ── GET /api/v1/docs.yaml — raw spec as YAML ──────────────────────────────
  app.get('/api/v1/docs.yaml', (req, res) => {
    res.setHeader('Content-Type', 'text/yaml');
    res.sendFile(YAML_PATH);
  });

  // ── GET /api/v1/docs — Swagger UI ─────────────────────────────────────────
  // Pass the spec object directly AND set the url option so the UI
  // re-fetches from /api/v1/docs.json (avoids the petstore default)
  app.use(
    '/api/v1/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, swaggerUiOptions)
  );

  const port = process.env.PORT || 5000;

  logger.info('Swagger UI available', {
    ui:   `http://localhost:${port}/api/v1/docs`,
    json: `http://localhost:${port}/api/v1/docs.json`,
    yaml: `http://localhost:${port}/api/v1/docs.yaml`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { setupSwagger, swaggerSpec };