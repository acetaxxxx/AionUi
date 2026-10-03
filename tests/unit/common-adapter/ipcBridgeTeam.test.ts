/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequestOptions } from '@/common/adapter/httpBridge';

type HttpCall = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
};

const httpBridgeMocks = vi.hoisted(() => {
  const calls: HttpCall[] = [];
  const provider =
    (method: HttpCall['method']) =>
    <Data, Params = undefined>(
      path: string | ((params: Params) => string),
      mapBodyOrOptions?: ((params: Params) => unknown) | HttpRequestOptions
    ) => ({
      provider: vi.fn(),
      invoke: vi.fn(async (params?: Params) => {
        const resolvedPath = typeof path === 'function' ? path(params as Params) : path;
        calls.push({
          method,
          path: resolvedPath,
          body:
            typeof mapBodyOrOptions === 'function' && params !== undefined
              ? mapBodyOrOptions(params as Params)
              : undefined,
        });
        return { active_run: null } as Data;
      }),
    });
  const emitter = () => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() });

  return {
    calls,
    httpGet: provider('GET'),
    httpPost: provider('POST'),
    httpPut: provider('PUT'),
    httpPatch: provider('PATCH'),
    httpDelete: provider('DELETE'),
    httpRequest: vi.fn(),
    stubProvider: vi.fn((name: string, defaultValue: unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async () => defaultValue),
    })),
    withResponseMap: vi.fn(
      (
        inner: { provider: unknown; invoke: (params?: unknown) => Promise<unknown> },
        map: (raw: unknown) => unknown
      ) => ({
        provider: inner.provider,
        invoke: vi.fn(async (params?: unknown) => map(await inner.invoke(params))),
      })
    ),
    wsEmitter: vi.fn(emitter),
    wsMappedEmitter: vi.fn(emitter),
    stubEmitter: vi.fn(emitter),
  };
});

vi.mock('@/common/adapter/httpBridge', () => httpBridgeMocks);

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      on: vi.fn(() => vi.fn()),
      emit: vi.fn(),
    })),
  },
}));

describe('ipcBridge team adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.calls.length = 0;
  });

  it('getRunState calls GET /api/teams/{team_id}/run-state', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.getRunState.invoke({ team_id: 'team-1' });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'GET',
      path: '/api/teams/team-1/run-state',
      body: undefined,
    });
  });

  it('answers Shared Team AskUser requests through the Team-scoped endpoint', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.answerAsk.invoke({
      team_id: 'team-1',
      conversation_id: 'conv/1',
      request_id: 'request/1',
      answers: [{ question: 'Which style?', labels: ['Tabs'] }],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/teams/team-1/conversations/conv%2F1/asks/request%2F1/answer',
      body: { answers: [{ question: 'Which style?', labels: ['Tabs'] }] },
    });
  });

  it('declines Shared Team AskUser requests without sending an answers payload', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.answerAsk.invoke({
      team_id: 'team-1',
      conversation_id: 'conv-1',
      request_id: 'request-1',
      decline: true,
      answers: [{ question: 'ignored', labels: ['ignored'] }],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/teams/team-1/conversations/conv-1/asks/request-1/answer',
      body: { decline: true },
    });
  });

  it('updateAgentModel persists the observed model through the team agent route', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.updateAgentModel.invoke({
      team_id: 'team-1',
      slot_id: 'worker-1',
      model_id: 'gpt-5.6-sol',
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'PATCH',
      path: '/api/teams/team-1/agents/worker-1/model',
      body: { model_id: 'gpt-5.6-sol' },
    });
  });

  it('interruptAgent posts the durable replacement message to the member interrupt route', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.interruptAgent.invoke({
      team_id: 'team-1',
      slot_id: 'worker-1',
      input: 'Use the corrected requirement',
      files: [{ kind: 'local', path: '/tmp/spec.md' }],
      reason: 'leader_intervention',
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/teams/team-1/agents/worker-1/interrupt',
      body: {
        message: 'Use the corrected requirement',
        files: [{ kind: 'local', path: '/tmp/spec.md' }],
        reason: 'leader_intervention',
        queued_policy: 'retain',
      },
    });
  });

  it('team.create posts canonical agents payload', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.create.invoke({
      user_id: 'user-1',
      name: 'Alpha',
      workspace: '/tmp/ws',
      workspace_mode: 'shared',
      agents: [
        {
          role: 'leader',
          assistant_name: 'Lead',
          assistant_id: 'assistant-lead',
          model: 'claude-sonnet-4',
        },
      ],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/teams',
      body: {
        name: 'Alpha',
        workspace: '/tmp/ws',
        workspace_mode: 'shared',
        agents: [
          {
            name: 'Lead',
            role: 'lead',
            model: 'claude-sonnet-4',
            assistant_id: 'assistant-lead',
          },
        ],
      },
    });
    expect(JSON.stringify(httpBridgeMocks.calls.at(-1)?.body)).not.toContain('assistants');
  });

  it('team.create with sharing_mode: shared omits workspace from the request body', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.create.invoke({
      user_id: 'user-1',
      name: 'Shared Team',
      workspace: '/unwanted/client/path',
      workspace_mode: 'shared',
      sharing_mode: 'shared',
      agents: [
        {
          role: 'leader',
          assistant_name: 'Lead',
          assistant_id: 'assistant-lead',
          model: 'claude-sonnet-4',
        },
      ],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/teams',
      body: {
        name: 'Shared Team',
        workspace_mode: 'shared',
        sharing_mode: 'shared',
        agents: [
          {
            name: 'Lead',
            role: 'lead',
            model: 'claude-sonnet-4',
            assistant_id: 'assistant-lead',
          },
        ],
      },
    });
    expect(httpBridgeMocks.calls.at(-1)?.body).not.toHaveProperty('workspace');
  });

  it('team.create with sharing_mode: private preserves workspace in the request body', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.create.invoke({
      user_id: 'user-1',
      name: 'Private Team',
      workspace: '/data/user/private-ws',
      workspace_mode: 'shared',
      sharing_mode: 'private',
      agents: [
        {
          role: 'leader',
          assistant_name: 'Lead',
          assistant_id: 'assistant-lead',
          model: 'claude-sonnet-4',
        },
      ],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/teams',
      body: {
        name: 'Private Team',
        workspace: '/data/user/private-ws',
        workspace_mode: 'shared',
        sharing_mode: 'private',
        agents: [
          {
            name: 'Lead',
            role: 'lead',
            model: 'claude-sonnet-4',
            assistant_id: 'assistant-lead',
          },
        ],
      },
    });
  });

  it('team.getMcpAllowlist calls GET /api/teams/{team_id}/mcp-allowlist', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.getMcpAllowlist.invoke({ team_id: 'team-42' });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'GET',
      path: '/api/teams/team-42/mcp-allowlist',
      body: undefined,
    });
  });

  it('team.listEligibleCollaborators calls GET /api/teams/eligible-collaborators?team_id={team_id}', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.listEligibleCollaborators.invoke({ team_id: 'team-42' });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'GET',
      path: '/api/teams/eligible-collaborators?team_id=team-42',
      body: undefined,
    });
  });

  it('team.setMcpAllowlist sends strictly mcp_server_ids payload to PUT /api/teams/{team_id}/mcp-allowlist', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.setMcpAllowlist.invoke({
      team_id: 'team-42',
      mcp_server_ids: ['mcp-srv-1', 'mcp-srv-2'],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'PUT',
      path: '/api/teams/team-42/mcp-allowlist',
      body: {
        mcp_server_ids: ['mcp-srv-1', 'mcp-srv-2'],
      },
    });

    const call = httpBridgeMocks.calls.find((c) => c.method === 'PUT' && c.path === '/api/teams/team-42/mcp-allowlist');
    expect(call?.body).toEqual({ mcp_server_ids: ['mcp-srv-1', 'mcp-srv-2'] });
    expect(call?.body).not.toHaveProperty('team_id');
    expect(call?.body).not.toHaveProperty('config');
    expect(call?.body).not.toHaveProperty('credentials');
  });

  it('team.setMcpAllowlist supports empty allowlist [] as fail-closed selection', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.setMcpAllowlist.invoke({
      team_id: 'team-42',
      mcp_server_ids: [],
    });

    const call = httpBridgeMocks.calls.find((c) => c.method === 'PUT' && c.path === '/api/teams/team-42/mcp-allowlist');
    expect(call?.body).toEqual({ mcp_server_ids: [] });
  });

  describe('team conversation adapters', () => {
    it('team.getConversation calls GET /api/teams/{team_id}/conversations/{conversation_id}', async () => {
      const { team } = await import('@/common/adapter/ipcBridge');

      await team.getConversation.invoke({ team_id: 'team-42', conversation_id: 'conv-lead-1' });

      expect(httpBridgeMocks.calls).toContainEqual({
        method: 'GET',
        path: '/api/teams/team-42/conversations/conv-lead-1',
        body: undefined,
      });
    });

    it('team.getConversationMessages calls GET /api/teams/{team_id}/conversations/{conversation_id}/messages with query params', async () => {
      const { team } = await import('@/common/adapter/ipcBridge');

      await team.getConversationMessages.invoke({
        team_id: 'team-42',
        conversation_id: 'conv-lead-1',
        limit: 30,
        before: 'msg-cursor-1',
        content_mode: 'compact',
      });

      expect(httpBridgeMocks.calls).toContainEqual({
        method: 'GET',
        path: '/api/teams/team-42/conversations/conv-lead-1/messages?limit=30&before=msg-cursor-1&content_mode=compact',
        body: undefined,
      });
    });

    it('team.getLatestConversationMessageOfType calls GET /api/teams/{team_id}/conversations/{conversation_id}/messages/latest?type=...', async () => {
      const { team } = await import('@/common/adapter/ipcBridge');

      await team.getLatestConversationMessageOfType.invoke({
        team_id: 'team-42',
        conversation_id: 'conv-lead-1',
        type: 'plan',
      });

      expect(httpBridgeMocks.calls).toContainEqual({
        method: 'GET',
        path: '/api/teams/team-42/conversations/conv-lead-1/messages/latest?type=plan',
        body: undefined,
      });
    });

    it('team.getConfirmations calls GET /api/teams/{team_id}/conversations/{conversation_id}/confirmations', async () => {
      const { team } = await import('@/common/adapter/ipcBridge');

      await team.getConfirmations.invoke({ team_id: 'team-42', conversation_id: 'conv-lead-1' });

      expect(httpBridgeMocks.calls).toContainEqual({
        method: 'GET',
        path: '/api/teams/team-42/conversations/conv-lead-1/confirmations',
        body: undefined,
      });
    });

    it('team.listArtifacts calls GET /api/teams/{team_id}/conversations/{conversation_id}/artifacts', async () => {
      const { team } = await import('@/common/adapter/ipcBridge');

      await team.listArtifacts.invoke({ team_id: 'team-42', conversation_id: 'conv-lead-1' });

      expect(httpBridgeMocks.calls).toContainEqual({
        method: 'GET',
        path: '/api/teams/team-42/conversations/conv-lead-1/artifacts',
        body: undefined,
      });
    });

    it('team.getSlashCommands calls GET /api/teams/{team_id}/conversations/{conversation_id}/slash-commands', async () => {
      const { team } = await import('@/common/adapter/ipcBridge');

      await team.getSlashCommands.invoke({ team_id: 'team-42', conversation_id: 'conv-lead-1' });

      expect(httpBridgeMocks.calls).toContainEqual({
        method: 'GET',
        path: '/api/teams/team-42/conversations/conv-lead-1/slash-commands',
        body: undefined,
      });
    });

    it('team.getUsage calls GET /api/teams/{team_id}/conversations/{conversation_id}/usage', async () => {
      const { team } = await import('@/common/adapter/ipcBridge');

      await team.getUsage.invoke({ team_id: 'team-42', conversation_id: 'conv-lead-1' });

      expect(httpBridgeMocks.calls).toContainEqual({
        method: 'GET',
        path: '/api/teams/team-42/conversations/conv-lead-1/usage',
        body: undefined,
      });
    });
  });

  it('exports mcp alias pointing to mcpService', async () => {
    const { mcp, mcpService } = await import('@/common/adapter/ipcBridge');
    expect(mcp).toBe(mcpService);
  });
});
