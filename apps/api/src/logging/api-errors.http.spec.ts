/**
 * Request logs and error answers over real HTTP, with the app set up as main.ts
 * sets it up and the logger it uses.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { configureApp } from '../app.setup';
import { AppLogger } from './app-logger';
import type { ErrorReport } from './error-reporter';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(
    'Invalid `prisma.user.create()` invocation: anna@example.test',
    {
      code,
      clientVersion: '6',
      meta: { modelName: 'User', target: ['email'] },
    },
  );

@Controller()
class FailingController {
  private readonly logger = new Logger('Failing');

  @Get('auth/invites/:token')
  invite(@Param('token') token: string) {
    return { length: token.length };
  }

  @Get('prisma/:code')
  prisma(@Param('code') code: string) {
    throw known(code);
  }

  @Get('crash')
  crash() {
    throw new TypeError('secret detail about anna@example.test');
  }

  @Get('invalid-query')
  invalid() {
    throw new Prisma.PrismaClientValidationError(
      'Invalid `prisma.user.create()` invocation: { name: "Anna Example" }',
      { clientVersion: '6' },
    );
  }

  @Get('refused')
  refused() {
    throw new BadRequestException('Say it another way');
  }

  @Post('echo')
  async echo(@Body() body: object) {
    await new Promise((resolve) => setImmediate(resolve));
    this.logger.log('Handling the echo');
    return body;
  }
}

describe('request logs and error answers', () => {
  let app: NestExpressApplication;
  type Line = {
    msg: string;
    route?: string;
    status?: number;
    requestId?: string;
    context?: string;
    code?: string;
    model?: string;
    error?: { stack: string[] };
  };
  let lines: Line[] = [];
  const reports: ErrorReport[] = [];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FailingController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useLogger(
      new AppLogger((_level, line) => lines.push(JSON.parse(line) as Line), {
        NODE_ENV: 'production',
      }),
    );
    configureApp(
      app,
      {},
      { errorReporter: { report: (r) => reports.push(r) } },
    );
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
    Logger.overrideLogger(false);
  });
  beforeEach(() => {
    lines = [];
    reports.length = 0;
  });

  /** The line is written as the response closes, which can be just after. */
  const requestLine = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return lines.find((line) => line.msg === 'request')!;
  };

  it('writes the route pattern, never the token in the path or the query', async () => {
    const response = await http()
      .get('/api/auth/invites/s3cretT0ken?token=an0ther')
      .set('X-Request-Id', 'chosen-by-the-caller')
      .expect(200);
    const line = await requestLine();
    expect(line).toMatchObject({
      method: 'GET',
      route: '/api/auth/invites/:token',
      status: 200,
      requestId: response.headers['x-request-id'],
    });
    expect(line.requestId).not.toBe('chosen-by-the-caller');
    expect(JSON.stringify(lines)).not.toMatch(/s3cretT0ken|an0ther/);
  });

  it('writes no path at all for a route that does not exist', async () => {
    await http().get('/api/auth/invite/s3cretT0ken/oops').expect(404);
    expect((await requestLine()).route).toBe('unmatched');
    expect(JSON.stringify(lines)).not.toContain('s3cretT0ken');
  });

  it('puts the request ID on lines logged while handling it', async () => {
    const response = await http().post('/api/echo').send({ a: 1 }).expect(201);
    const inside = lines.find((line) => line.msg === 'Handling the echo');
    expect(inside?.requestId).toBe(response.headers['x-request-id']);
    expect(inside?.context).toBe('Failing');
  });

  it.each([
    ['P2002', 409],
    ['P2025', 404],
    ['P2003', 409],
    ['P2000', 400],
    ['P2024', 503],
  ])(
    'answers %s with %i and says nothing about the table',
    async (code, status) => {
      const response = await http().get(`/api/prisma/${code}`).expect(status);
      expect(response.body.statusCode).toBe(status);
      expect(JSON.stringify(response.body)).not.toMatch(
        /prisma|User|email|anna/i,
      );
      expect(JSON.stringify(lines)).not.toContain('anna');
      expect(lines.find((line) => line.code === code)?.model).toBe('User');
      expect(reports).toHaveLength(0);
    },
  );

  it.each(['/api/prisma/P9999', '/api/crash', '/api/invalid-query'])(
    'answers %s with a bare 500, and logs and reports it without personal data',
    async (path) => {
      const response = await http().get(path).expect(500);
      expect(response.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        requestId: response.headers['x-request-id'],
      });
      expect(reports).toHaveLength(1);
      expect(reports[0].requestId).toBe(response.body.requestId);
      const logged = lines.find((line) => line.msg === 'Unexpected error')!;
      expect(logged.requestId).toBe(reports[0].requestId);
      expect(logged.error?.stack.length).toBeGreaterThan(0);
      expect(JSON.stringify([lines, reports])).not.toMatch(/anna|Anna Example/);
    },
  );

  it('leaves an error thrown on purpose as it is', async () => {
    const response = await http().get('/api/refused').expect(400);
    expect(response.body.message).toBe('Say it another way');
  });

  it('answers a body that is too large or broken, without logging the body', async () => {
    const large = await http()
      .post('/api/echo')
      .send({ filler: 'x'.repeat(200 * 1024) })
      .expect(413);
    expect(large.body.statusCode).toBe(413);
    expect((await requestLine()).status).toBe(413);
    lines = [];
    await http()
      .post('/api/echo')
      .set('Content-Type', 'application/json')
      .send('{"password": hunter2hunter2')
      .expect(400);
    await requestLine();
    expect(JSON.stringify(lines)).not.toContain('hunter2');
    expect(reports).toHaveLength(0);
  });
});
