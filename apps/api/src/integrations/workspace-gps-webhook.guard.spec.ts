import {
  hashGatewaySecret,
  WorkspaceGpsWebhookGuard,
} from './workspace-gps-webhook.guard';

function context(slug: string, secret?: string) {
  const request = {
    params: { slug },
    header: (name: string) =>
      name.toLowerCase() === 'x-harbour-gps-secret' ? secret : undefined,
  } as Record<string, unknown>;
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
  };
}

function guard(workspace: unknown) {
  return new WorkspaceGpsWebhookGuard({
    organisation: { findUnique: jest.fn().mockResolvedValue(workspace) },
  } as never);
}

const active = {
  id: 'org-1',
  status: 'ACTIVE',
  settings: { gpsWebhookSecretHash: hashGatewaySecret('right') },
};

describe('WorkspaceGpsWebhookGuard', () => {
  it('lets in the workspace’s own secret and names the workspace', async () => {
    const { request, context: ctx } = context('acme', 'right');
    await expect(guard(active).canActivate(ctx)).resolves.toBe(true);
    expect(request.gpsOrganisationId).toBe('org-1');
  });

  it('refuses a wrong or missing secret', async () => {
    await expect(
      guard(active).canActivate(context('acme', 'wrong').context),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      guard(active).canActivate(context('acme').context),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a workspace with no secret, or one that is not active', async () => {
    await expect(
      guard({ ...active, settings: null }).canActivate(
        context('acme', 'right').context,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      guard({ ...active, status: 'SUSPENDED' }).canActivate(
        context('acme', 'right').context,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an unknown workspace the same way', async () => {
    await expect(
      guard(null).canActivate(context('nobody', 'right').context),
    ).rejects.toMatchObject({ status: 401 });
  });
});
