/**
 * The app as main.ts sets it up, over real HTTP: the proxy setting, CORS, body
 * sizes, and the limit on every public auth route and invite route. The
 * services behind the routes are stand-ins.
 */
import { CanActivate, Controller, Module, Post, Body } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp, corsOrigins, trustedProxyHops } from './app.setup';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PasswordResetController } from './auth/password-reset/password-reset.controller';
import { PasswordResetService } from './auth/password-reset/password-reset.service';
import { RolesGuard } from './auth/roles.guard';
import { SignupController } from './auth/signup/signup.controller';
import { SignupService } from './auth/signup/signup.service';
import { TwoFactorController } from './auth/two-factor/two-factor.controller';
import { TwoFactorService } from './auth/two-factor/two-factor.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { OrganisationsController } from './organisations/organisations.controller';
import { OrganisationsService } from './organisations/organisations.service';
import { RATE_LIMITS, type RateLimitPolicy } from './rate-limit/policies';
import { RateLimitModule } from './rate-limit/rate-limit.module';

@Controller()
class EchoController {
  @Post(['integrations/gps/flespi', 'echo'])
  echo(@Body() body: { filler?: string }) {
    return { length: body.filler?.length ?? 0 };
  }
}

/** Signs in whoever the test names, in the organisation it names. */
const signedIn: CanActivate = {
  canActivate(context) {
    const req = context.switchToHttp().getRequest<{
      user: unknown;
      headers: Record<string, string>;
    }>();
    req.user = {
      id: req.headers['x-test-user'],
      organisationId: req.headers['x-test-organisation'],
      role: 'ADMIN',
    };
    return true;
  },
};

const services = [
  AuthService,
  SignupService,
  PasswordResetService,
  TwoFactorService,
  OrganisationsService,
  CustomersService,
];
const anything = () =>
  new Proxy(
    {},
    {
      get: (_target, name) => (name === 'then' ? undefined : () => undefined),
    },
  );

@Module({ imports: [RateLimitModule] })
class LimitsModule {}

async function start(env: NodeJS.ProcessEnv) {
  const builder = Test.createTestingModule({
    imports: [LimitsModule],
    controllers: [
      EchoController,
      AuthController,
      SignupController,
      PasswordResetController,
      TwoFactorController,
      OrganisationsController,
      CustomersController,
    ],
    providers: services.map((provide) => ({
      provide,
      useValue: anything(),
    })),
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(signedIn)
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true });
  const module = await builder.compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, env);
  await app.init();
  return app;
}

const production = {
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://harbour.example',
};

describe('the app setup', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    app = await start(production);
  });
  afterEach(() => app.close());

  it('does not name the server software', async () => {
    const response = await http().post('/api/echo').send({});
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows only the web origin in production', async () => {
    const allowed = await http()
      .options('/api/echo')
      .set('Origin', 'https://harbour.example');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://harbour.example',
    );
    for (const origin of ['http://localhost:5173', 'https://evil.example']) {
      const refused = await http().options('/api/echo').set('Origin', origin);
      expect(refused.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('takes a large body on the Flespi webhook only', async () => {
    const filler = 'x'.repeat(500 * 1024);
    await http()
      .post('/api/integrations/gps/flespi')
      .send({ filler })
      .expect(201, { length: filler.length });
    await http().post('/api/echo').send({ filler }).expect(413);
    await http()
      .post('/api/integrations/gps/flespi')
      .send({ filler: 'x'.repeat(3 * 1024 * 1024) })
      .expect(413);
  });

  /** The header as the edge Caddy leaves it, after whatever the caller sent. */
  const login = (forwardedFor: string) =>
    http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: 'a@example.com', password: 'a-long-password' });

  it('counts the address Caddy saw, whatever the caller claims', async () => {
    for (let i = 0; i < RATE_LIMITS.loginIp.limit; i += 1) {
      await login(`10.0.0.${i}, 203.0.113.7`).expect(201);
    }
    const stopped = await login('10.9.9.9, 203.0.113.7').expect(429);
    expect(Number(stopped.headers['retry-after'])).toBeGreaterThan(0);
    // Someone at another address is not affected.
    await login('203.0.113.8').expect(201);
  });

  const body = { email: 'a@example.com', password: 'a-long-password' };
  it.each<[RateLimitPolicy, 'get' | 'post', string, object]>([
    ['loginIp', 'post', '/api/auth/login', body],
    [
      'twoFactorIp',
      'post',
      '/api/auth/two-factor/challenge',
      { challengeToken: 'x'.repeat(40), code: '123456' },
    ],
    [
      'signupIp',
      'post',
      '/api/auth/signup',
      { ...body, name: 'Anna', organisationName: 'Anna Imports' },
    ],
    ['signupConfirmIp', 'get', '/api/auth/signup/confirm/abc', {}],
    ['forgotPasswordIp', 'post', '/api/auth/password/forgot', body],
    ['resetPasswordIp', 'get', '/api/auth/password/reset/abc', {}],
    [
      'resetPasswordIp',
      'post',
      '/api/auth/password/reset',
      { ...body, token: 'abc' },
    ],
    ['invitePreviewIp', 'get', '/api/auth/invites/abc', {}],
    ['inviteAcceptIp', 'post', '/api/auth/invites/abc/accept', body],
  ])('limits %s on %s %s', async (policy, method, path, payload) => {
    const call = () =>
      http()[method](path).set('X-Forwarded-For', '203.0.113.7').send(payload);
    for (let i = 0; i < RATE_LIMITS[policy].limit; i += 1) {
      const response = await call();
      expect(response.status).toBeLessThan(400);
    }
    await call().expect(429);
  });

  it('answers sign-up with no body, whoever the email belongs to', async () => {
    const response = await http()
      .post('/api/auth/signup')
      .send({ ...body, name: 'Anna', organisationName: 'Anna Imports' })
      .expect(204);
    expect(response.text).toBe('');
  });

  const sends = [
    ['/api/organisation/members/invite', { ...body, role: 'STAFF' }],
    ['/api/organisation/members/m1/resend-invite', {}],
    ['/api/customers/c1/invite', {}],
  ] as const;
  const send = (path: string, user: string, organisation: string, ip: string) =>
    http()
      .post(path)
      .set('X-Forwarded-For', ip)
      .set('x-test-user', user)
      .set('x-test-organisation', organisation)
      .send({ name: 'Sam', email: 'sam@example.com', role: 'STAFF' });

  it.each(sends)('limits invite sending by user on %s', async (path) => {
    for (let i = 0; i < RATE_LIMITS.inviteSendUser.limit; i += 1) {
      await send(path, 'u1', 'org-a', `198.51.100.${i}`).expect(201);
    }
    await send(path, 'u1', 'org-a', '198.51.100.200').expect(429);
    await send(path, 'u2', 'org-a', '198.51.100.201').expect(201);
  });

  it('limits invite sending by organisation, leaving the other one alone', async () => {
    const [path] = sends[0];
    for (let i = 0; i < RATE_LIMITS.inviteSendOrganisation.limit; i += 1) {
      await send(path, `u${i % 5}`, 'org-a', `198.51.100.${i}`).expect(201);
    }
    await send(path, 'u9', 'org-a', '192.0.2.1').expect(429);
    await send(path, 'u9', 'org-b', '192.0.2.2').expect(201);
  });
});

describe('the proxy setting', () => {
  it('trusts one proxy in production and none in development', () => {
    expect(trustedProxyHops({ NODE_ENV: 'production' })).toBe(1);
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(
      trustedProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 'true' }),
    ).toBe(1);
  });

  it('ignores the header where there is no proxy', async () => {
    const app = await start({});
    const call = (i: number) =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({ email: 'a@example.com', password: 'a-long-password' });
    for (let i = 0; i < RATE_LIMITS.loginIp.limit; i += 1) await call(i);
    await call(99).expect(429);
    await app.close();
  });

  it('adds the local web addresses outside production only', () => {
    expect(corsOrigins({})).toContain('http://localhost:5173');
    expect(
      corsOrigins({ ...production, WEB_ORIGIN: 'https://harbour.example/' }),
    ).toEqual(['https://harbour.example']);
    expect(corsOrigins({ NODE_ENV: 'production' })).toEqual([]);
  });
});
