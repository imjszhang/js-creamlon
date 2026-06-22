import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmdCaller } from '../cli/callerInbox.mjs';
import { setGithubFetch } from '../lib/github.mjs';
import { findInbox, readInboxRegistry } from '../lib/inboxRegistry.mjs';

after(() => setGithubFetch(globalThis.fetch));

function response(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body == null ? '' : JSON.stringify(body)),
  };
}

test('caller inbox init, grant, check, and revoke manage a per-node repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-caller-inbox-'));
  const registryPath = join(dir, 'inboxes.yaml');
  const calls = [];
  let inboxExists = false;
  setGithubFetch(async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body && JSON.parse(init.body) });
    if (path === '/repos/bob/echo-node') {
      return response(200, { owner: { login: 'bob', type: 'User' } });
    }
    if (path === '/users/bob') return response(200, { login: 'bob', type: 'User' });
    if (path === '/user') return response(200, { login: 'alice' });
    if (path === '/repos/alice/creamlon-inbox-bob-echo-node') {
      if (!inboxExists) return response(404, { message: 'Not Found' });
      return response(200, {
        private: true,
        default_branch: 'main',
        owner: { login: 'alice', type: 'User' },
        permissions: { pull: true, push: true, admin: true },
      });
    }
    if (path === '/user/repos' && init.method === 'POST') {
      inboxExists = true;
      return response(201, {
        private: true,
        default_branch: 'main',
        owner: { login: 'alice', type: 'User' },
      });
    }
    if (path === '/repos/alice/creamlon-inbox-bob-echo-node/collaborators/bob'
      && init.method === 'PUT') {
      return response(201, { id: 123 });
    }
    if (path === '/repos/alice/creamlon-inbox-bob-echo-node/collaborators/bob/permission') {
      return response(200, { permission: 'write' });
    }
    if (path === '/repos/alice/creamlon-inbox-bob-echo-node/rulesets'
      && init.method === 'GET') {
      return response(200, [{
        id: 7,
        name: 'Unrelated review policy',
      }]);
    }
    if (path === '/repos/alice/creamlon-inbox-bob-echo-node/rulesets'
      && init.method === 'POST') {
      return response(201, { id: 8 });
    }
    if (path === '/repos/alice/creamlon-inbox-bob-echo-node/rules/branches/main') {
      return response(200, [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
      ]);
    }
    if (path === '/repos/alice/creamlon-inbox-bob-echo-node/collaborators/bob'
      && init.method === 'DELETE') {
      return response(204);
    }
    return response(404, { message: 'Not Found' });
  });
  const output = [];
  const ctx = {
    resolveToken: (opts) => opts.token,
    loadManifestContext: async () => ({
      owner: 'bob',
      repo: 'echo-node',
      parsed: {
        profiles: { github: { transport: 'issues', operator: 'bob' } },
        extensions: {
          delivery: {
            github: {
              inbox_path_template: {
                input: 'tasks/{request_id}/input.enc',
                output: 'tasks/{request_id}/output.enc',
              },
            },
          },
        },
      },
    }),
    printJson: (value) => output.push(value),
  };
  const base = { node: 'bob/echo-node', registry: registryPath, token: 'caller-token' };

  await cmdCaller(['caller', 'inbox', 'init'], base, ctx);
  let entry = findInbox(await readInboxRegistry(registryPath), base.node);
  assert.equal(entry.repo, 'github:alice/creamlon-inbox-bob-echo-node');
  assert.equal(entry.operator, 'bob');

  await cmdCaller(['caller', 'inbox', 'grant'], base, ctx);
  entry = findInbox(await readInboxRegistry(registryPath), base.node);
  assert.equal(entry.grant, 'invitation-pending-push');
  assert.equal(entry.granted_at, null);
  const invitationCall = calls.find((call) => call.method === 'PUT');
  assert.deepEqual(invitationCall.body, {});

  await cmdCaller(['caller', 'inbox', 'init'], base, ctx);
  entry = findInbox(await readInboxRegistry(registryPath), base.node);
  assert.equal(entry.grant, 'invitation-pending-push');

  await cmdCaller(['caller', 'inbox', 'protect'], base, ctx);
  assert.equal(output.at(-1).hardened, true);
  const rulesetCall = calls.find((call) => call.path.endsWith('/rulesets')
    && call.method === 'POST');
  assert.deepEqual(rulesetCall.body.rules, [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
  ]);
  assert.ok(!calls.some((call) => call.path.includes('/branches/main/protection')));

  await cmdCaller(['caller', 'inbox', 'check'], base, ctx);
  assert.equal(output.at(-1).ready, true);
  assert.equal(output.at(-1).branch_protection.hardened, true);
  entry = findInbox(await readInboxRegistry(registryPath), base.node);
  assert.equal(entry.grant, 'collaborator-write');
  assert.ok(entry.granted_at);

  await cmdCaller(['caller', 'inbox', 'revoke'], base, ctx);
  entry = findInbox(await readInboxRegistry(registryPath), base.node);
  assert.equal(entry.grant, null);
  assert.ok(calls.some((call) => call.path === '/user/repos' && call.method === 'POST'));
  assert.ok(calls.some((call) => call.method === 'DELETE'));

  await cmdCaller(['caller', 'inbox', 'list'], { registry: registryPath }, ctx);
  assert.equal(output.at(-1).count, 1);
  assert.equal(output.at(-1).inboxes[0].node, base.node);

  await cmdCaller(['caller', 'inbox', 'remove'], base, ctx);
  assert.equal(findInbox(await readInboxRegistry(registryPath), base.node), null);
});

test('same-account inbox access does not add or remove the repository owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-same-account-inbox-'));
  const registryPath = join(dir, 'inboxes.yaml');
  const calls = [];
  let inboxExists = false;
  setGithubFetch(async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || 'GET' });
    if (path === '/repos/alice/echo-node') {
      return response(200, { owner: { login: 'alice', type: 'User' } });
    }
    if (path === '/users/alice') return response(200, { login: 'alice', type: 'User' });
    if (path === '/user') return response(200, { login: 'alice' });
    if (path === '/repos/alice/creamlon-inbox-alice-echo-node') {
      if (!inboxExists) return response(404, { message: 'Not Found' });
      return response(200, {
        private: true,
        default_branch: 'main',
        owner: { login: 'alice', type: 'User' },
        permissions: { pull: true, push: true, admin: true },
      });
    }
    if (path === '/user/repos' && init.method === 'POST') {
      inboxExists = true;
      return response(201, {
        private: true,
        default_branch: 'main',
        owner: { login: 'alice', type: 'User' },
      });
    }
    return response(404, { message: 'Not Found' });
  });
  const output = [];
  const ctx = {
    resolveToken: (opts) => opts.token,
    loadManifestContext: async () => ({
      owner: 'alice',
      repo: 'echo-node',
      parsed: { profiles: { github: { transport: 'issues' } }, extensions: {} },
    }),
    printJson: (value) => output.push(value),
  };
  const base = { node: 'alice/echo-node', registry: registryPath, token: 'caller-token' };

  await cmdCaller(['caller', 'inbox', 'init'], base, ctx);
  await cmdCaller(['caller', 'inbox', 'grant'], base, ctx);
  let entry = findInbox(await readInboxRegistry(registryPath), base.node);
  assert.equal(entry.grant, 'owner-admin');
  assert.equal(output.at(-1).owner_has_implicit_access, true);

  await cmdCaller(['caller', 'inbox', 'check'], base, ctx);
  assert.equal(output.at(-1).ready, true);
  await cmdCaller(['caller', 'inbox', 'revoke'], base, ctx);
  assert.equal(output.at(-1).revoked, false);
  assert.ok(!calls.some((call) => call.path.includes('/collaborators/')));
  entry = findInbox(await readInboxRegistry(registryPath), base.node);
  assert.equal(entry.grant, 'owner-admin');
});

test('caller inbox refuses to use the node repository as the inbox target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-unsafe-inbox-'));
  const registryPath = join(dir, 'inboxes.yaml');
  const calls = [];
  setGithubFetch(async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || 'GET' });
    if (path === '/repos/bob/echo-node') {
      return response(200, { owner: { login: 'bob', type: 'User' } });
    }
    if (path === '/users/bob') return response(200, { login: 'bob', type: 'User' });
    if (path === '/user') return response(200, { login: 'alice' });
    return response(404, { message: 'Not Found' });
  });
  const output = [];
  const ctx = {
    resolveToken: (opts) => opts.token,
    loadManifestContext: async () => ({
      owner: 'bob',
      repo: 'echo-node',
      parsed: { profiles: { github: { operator: 'bob' } } },
    }),
    printJson: (value) => output.push(value),
  };

  await assert.rejects(
    () => cmdCaller(['caller', 'inbox', 'init'], {
      node: 'bob/echo-node',
      githubRepo: 'github:bob/echo-node',
      registry: registryPath,
      token: 'caller-token',
    }, ctx),
    /inbox must be separate from node repository/,
  );
  assert.ok(!calls.some((call) => call.method === 'POST' || call.method === 'PUT' || call.method === 'DELETE'));

  await writeFile(registryPath, `version: "1"
inboxes:
  - node: bob/echo-node
    operator: bob
    repo: github:bob/echo-node
`, 'utf8');
  await assert.rejects(
    () => cmdCaller(['caller', 'inbox', 'grant'], {
      node: 'bob/echo-node',
      registry: registryPath,
      token: 'caller-token',
    }, ctx),
    /inbox must be separate from node repository/,
  );
  assert.ok(!calls.some((call) => call.path.includes('/collaborators/') || call.path.includes('/rulesets')));

  await cmdCaller(['caller', 'inbox', 'check'], {
    node: 'bob/echo-node',
    registry: registryPath,
    token: 'caller-token',
  }, ctx);
  assert.equal(output.at(-1).config_ok, false);
  assert.deepEqual(output.at(-1).misconfigurations, ['inbox_repo_equals_node']);
});

test('caller inbox init requires an operator for organization-owned nodes', async () => {
  setGithubFetch(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/repos/acme/echo-node') {
      return response(200, { owner: { login: 'acme', type: 'Organization' } });
    }
    return response(404, { message: 'Not Found' });
  });
  await assert.rejects(
    () => cmdCaller(
      ['caller', 'inbox', 'init'],
      { node: 'acme/echo-node', token: 'caller-token' },
      {
        resolveToken: (opts) => opts.token,
        loadManifestContext: async () => ({
          owner: 'acme',
          repo: 'echo-node',
          parsed: { profiles: { github: { transport: 'issues' } }, extensions: {} },
        }),
        printJson: () => {},
      },
    ),
    /organization-owned nodes must declare profiles.github.operator/,
  );
});

test('caller inbox init rejects an organization as operator', async () => {
  setGithubFetch(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/repos/acme/echo-node') {
      return response(200, { owner: { login: 'acme', type: 'Organization' } });
    }
    if (path === '/users/acme') {
      return response(200, { login: 'acme', type: 'Organization' });
    }
    return response(404, { message: 'Not Found' });
  });
  await assert.rejects(
    () => cmdCaller(
      ['caller', 'inbox', 'init'],
      { node: 'acme/echo-node', operator: 'acme', token: 'caller-token' },
      {
        resolveToken: (opts) => opts.token,
        loadManifestContext: async () => ({
          owner: 'acme',
          repo: 'echo-node',
          parsed: { profiles: { github: { transport: 'issues' } }, extensions: {} },
        }),
        printJson: () => {},
      },
    ),
    /GitHub operator must be a user account/,
  );
});
