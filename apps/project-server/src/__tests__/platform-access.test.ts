import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { prisma } from '../db.js';
import { createServer } from '../server.js';

const TOKEN = 'a-token-that-is-long-enough-for-the-server';
const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: null } };

/** Authentication, origins and body size of the project server (feature 015, RF-03, RF-05, RF-06). */
describe('platform access', () => {
  const services = createContainer(loadConfig());

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  describe('with a token', () => {
    const app = createServer(services, { apiToken: TOKEN });

    it('refuses a request without the token, with a malformed header or with a wrong token, all alike', async () => {
      for (const authorization of [undefined, TOKEN, 'Basic abc', `Bearer ${TOKEN}x`]) {
        const call = request(app).get('/api/projects');
        const response = await (authorization ? call.set('Authorization', authorization) : call);
        expect([response.status, response.body], String(authorization)).toEqual([401, UNAUTHORIZED]);
        expect(response.headers['www-authenticate']).toBe('Bearer');
      }
    });

    it('accepts the right token', async () => {
      const response = await request(app).get('/api/projects').set('Authorization', `Bearer ${TOKEN}`);
      expect([response.status, response.body]).toEqual([200, []]);
    });

    it('guards the downloads too', async () => {
      const refused = await request(app).get('/api/compiler/downloads/missing.zip');
      expect(refused.status).toBe(401);
      const allowed = await request(app).get('/api/compiler/downloads/missing.zip').set('Authorization', `Bearer ${TOKEN}`);
      expect(allowed.status).toBe(404);
    });

    it('checks the token before parsing the body', async () => {
      const response = await request(app).post('/api/projects/import').set('Content-Type', 'application/json').send('{ not json');
      expect(response.status).toBe(401);
    });
  });

  it('stays open without a token', async () => {
    const response = await request(createServer(services)).get('/api/projects');
    expect(response.status).toBe(200);
  });

  describe('body limit', () => {
    const big = JSON.stringify({ padding: 'x'.repeat(6_000_000) });

    it('answers 413 above 5 MB', async () => {
      const response = await request(createServer(services)).post('/api/projects/import').set('Content-Type', 'application/json').send(big);
      expect([response.status, response.body]).toEqual([413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 5mb', details: null } }]);
    });

    it('follows the configured limit', async () => {
      const response = await request(createServer(services, { bodyLimit: '10mb' })).post('/api/projects/import').set('Content-Type', 'application/json').send(big);
      expect(response.status).toBe(400);
    });
  });

  describe('origins', () => {
    it('gives no origin permission by default', async () => {
      const response = await request(createServer(services)).get('/api/projects').set('Origin', 'http://evil.example');
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('lets a listed origin read responses and pass its preflight, even with a token', async () => {
      const app = createServer(services, { apiToken: TOKEN, corsOrigins: ['https://tools.example'] });
      const listed = await request(app).get('/api/projects').set('Origin', 'https://tools.example').set('Authorization', `Bearer ${TOKEN}`);
      expect(listed.headers['access-control-allow-origin']).toBe('https://tools.example');
      const preflight = await request(app).options('/api/projects').set('Origin', 'https://tools.example').set('Access-Control-Request-Method', 'PUT');
      expect(preflight.status).toBe(204);
      const other = await request(app).get('/api/projects').set('Origin', 'http://evil.example').set('Authorization', `Bearer ${TOKEN}`);
      expect(other.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
