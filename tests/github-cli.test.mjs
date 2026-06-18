import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../cli/index.mjs';
import {
  createIssue,
  getRepositoryFile,
  searchRepositories,
  setGithubFetch,
} from '../lib/github.mjs';
import { parseManifest, setManifestFetch } from '../lib/manifest.mjs';
import { hashText } from '../lib/hash.mjs';
import { buildProofFields, signProof, generateKeyPair } from '../lib/proof.mjs';
import { signHmacAuthorization } from '../lib/authorizationHmac.mjs';
import { parseTask, serializeTask } from '../lib/task.mjs';
import { signKeyRotation } from '../lib/identity.mjs';
import {
  authorizeCredential,
  generateCredential,
  loadRedemptions,
  writeCredentialStore,
} from '../lib/credential.mjs';

const MANIFEST_YAML = `version: "1"
name: mock-node
description: Mock
identity:
  type: ed25519
  public_key: PLACEHOLDER
status: available
capabilities:
  - id: echo
    description: Echo
    input:
      media_types: [text/plain]
    output:
      media_types: [text/plain]
profiles:
  github:
    transport: issues
  authorization:
    scheme: hmac-sha256
extensions: {}
`;
const FREE_MANIFEST_YAML = MANIFEST_YAML.replace(
  '  authorization:\n    scheme: hmac-sha256\n',
  '',
);
const CREDENTIAL_MANIFEST_YAML = FREE_MANIFEST_YAML
  .replace(
    '    output:\n      media_types: [text/plain]',
    '    output:\n      media_types: [text/plain]\n    access:\n      mode: credential\n      units: 1',
  )
  .replace(
    '  github:\n    transport: issues',
    '  github:\n    transport: issues\n  credential:\n    scheme: voucher-hmac-v1',
  );

const AUTHORIZATION_KEY_ID = 'customer-1';
const AUTHORIZATION_SECRET = 'node-secret';
const AUTHORIZATION_EXPIRES = '2099-01-01T00:00:00Z';
const AUTHORIZATION_DIR = await mkdtemp(join(tmpdir(), 'creamlon-test-keys-'));
const AUTHORIZATION_KEYS_PATH = join(AUTHORIZATION_DIR, 'authorization.keys.json');
await writeFile(AUTHORIZATION_KEYS_PATH, `${JSON.stringify({ [AUTHORIZATION_KEY_ID]: AUTHORIZATION_SECRET })}\n`, 'utf8');
after(() => rm(AUTHORIZATION_DIR, { recursive: true, force: true }));

function assertPrivateMode(mode) {
  if (process.platform !== 'win32') assert.equal(mode & 0o077, 0);
}

function restoreEnv(name, value) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

function taskYaml({ requestId, input = 'hello', includeAuthorization = true }) {
  const task = {
    version: '1',
    request_id: requestId,
    capability_id: 'echo',
    requester: 'github:alice/caller',
    input: {
      media_type: 'text/plain',
      value: input,
    },
    expires: null,
    authorization: null,
  };
  if (includeAuthorization) {
    task.authorization = signHmacAuthorization(task, {
      keyId: AUTHORIZATION_KEY_ID,
      secret: AUTHORIZATION_SECRET,
      expires: AUTHORIZATION_EXPIRES,
    });
  }
  return serializeTask(task);
}

const AUTHORIZATION_ARGS = [
  '--authorization-key-id', AUTHORIZATION_KEY_ID,
  '--keys', AUTHORIZATION_KEYS_PATH,
  '--authorization-expires', AUTHORIZATION_EXPIRES,
];

const NODE_AUTHORIZATION_ARGS = [
  '--keys', AUTHORIZATION_KEYS_PATH,
];

function installMockFetch(handler) {
  const fetchFn = async (url, init) => {
    const result = handler(url, init);
    if (result instanceof Error) throw result;
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => (typeof result.body === 'string' ? result.body : JSON.stringify(result.body)),
    };
  };
  setGithubFetch(fetchFn);
  setManifestFetch(fetchFn);
}

function resetFetch() {
  setGithubFetch(globalThis.fetch);
  setManifestFetch(globalThis.fetch);
}

test('GitHub writes require authentication while public reads may be anonymous', async () => {
  await assert.rejects(
    () => createIssue('owner', 'repo', 'title', 'body', null),
    /GitHub token required/,
  );
});

test('submit creates issue via mocked GitHub API', async () => {
  const calls = [];
  const { generateKeyPair: gen } = await import('../lib/proof.mjs');
  const { publicKeyBase64Url } = await gen(null);

  installMockFetch((url, init) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    if (url.endsWith('/issues') && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      calls.push(body);
      return {
        status: 201,
        body: { number: 7, html_url: 'https://github.com/o/r/issues/7', title: body.title },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  try {
    await runCli([
      'submit', 'owner/repo',
      '--capability-id', 'echo',
      '--input', 'hello',
      '--media-type', 'text/plain',
      '--requester', 'github:alice/caller',
      '--request-id', 'req-submit-1',
      ...AUTHORIZATION_ARGS,
      '--token', 'test-token',
    ]);
  } finally {
    resetFetch();
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, '[task] echo');
  assert.match(calls[0].body, /req-submit-1/);
});

test('submit requires an HMAC key', async () => {
  const { publicKeyBase64Url } = await generateKeyPair(null);

  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  try {
    await assert.rejects(
      () => runCli([
        'submit', 'owner/repo',
        '--capability-id', 'echo',
        '--input', 'hello',
        '--media-type', 'text/plain',
        '--requester', 'github:alice/caller',
        '--token', 'test-token',
      ]),
      (err) => err.message.includes('--authorization-key-id'),
    );
  } finally {
    resetFetch();
  }
});

test('submit supports a free node without authorization options', async () => {
  const { publicKeyBase64Url } = await generateKeyPair(null);
  const calls = [];
  installMockFetch((url, init) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: FREE_MANIFEST_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    if (url.endsWith('/issues') && init?.method === 'POST') {
      calls.push(JSON.parse(init.body));
      return {
        status: 201,
        body: { number: 8, html_url: 'https://github.com/o/r/issues/8', title: '[task] echo' },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  try {
    await runCli([
      'submit', 'owner/repo',
      '--capability-id', 'echo',
      '--media-type', 'text/plain',
      '--input', 'hello',
      '--requester', 'github:alice/caller',
      '--token', 'test-token',
    ]);
  } finally {
    resetFetch();
  }

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].body, /authorization:/);
});

test('submit posts the exact delivery task from --task-file', async () => {
  const { publicKeyBase64Url } = await generateKeyPair(null);
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-submit-ext-'));
  const taskPath = join(dir, 'task.yaml');
  const task = {
    version: '1',
    request_id: 'req-task-file',
    capability_id: 'echo',
    requester: 'github:alice/caller',
    input: {
      media_type: 'text/plain',
      digest: hashText('hello'),
    },
    extensions: {
      delivery: {
      scheme: 'hpke-x25519-hkdf-sha256-aes256gcm-v2',
      transport: 'presigned-object-storage',
      ephemeral_public_key: 'YWJjZGVmZ2hpamsxMjM0NTY3ODkwQUJDREVGR0hJSktMTU5P',
      artifacts: {
        input: { upload_url: 'https://storage.example/input-put' },
        output: { upload_url: 'https://storage.example/output-put' },
      },
    },
    },
  };
  await writeFile(taskPath, serializeTask(task));
  const calls = [];
  installMockFetch((url, init) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: FREE_MANIFEST_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    if (url.endsWith('/issues') && init?.method === 'POST') {
      calls.push(JSON.parse(init.body));
      return {
        status: 201,
        body: { number: 9, html_url: 'https://github.com/o/r/issues/9', title: '[task] echo' },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  try {
    await runCli([
      'submit', 'owner/repo',
      '--task-file', taskPath,
      '--token', 'test-token',
    ]);
  } finally {
    resetFetch();
    await rm(dir, { recursive: true, force: true });
  }

  assert.equal(calls.length, 1);
  const submitted = parseTask(calls[0].body);
  assert.equal(submitted.request_id, 'req-task-file');
  assert.deepEqual(submitted.extensions, task.extensions);
});

test('credential CLI creates, lists, and revokes without reprinting secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-credential-cli-'));
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(message);
  try {
    await runCli([
      'credential', 'create',
      '--repo-path', dir,
      '--capability-id', 'echo',
      '--pretty',
    ]);
    const created = JSON.parse(logs.pop());
    assert.match(created.credential, /^crv1_/);
    const secret = created.credential.split('.')[1];

    await runCli(['credential', 'list', '--repo-path', dir, '--pretty']);
    const listedText = logs.pop();
    const listed = JSON.parse(listedText);
    assert.equal(listed.credentials[0].status, 'available');
    assert.doesNotMatch(listedText, new RegExp(secret));

    await runCli([
      'credential', 'revoke', created.credential_id,
      '--repo-path', dir,
      '--pretty',
    ]);
    const revoked = JSON.parse(logs.pop());
    assert.equal(revoked.status, 'revoked');
  } finally {
    console.log = originalLog;
    await rm(dir, { recursive: true, force: true });
  }
});

test('paid submit hides secret and deliver atomically redeems credential into proof', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-paid-delivery-'));
  const calls = [];
  let issueBody = null;
  let issueState = 'open';
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    const manifestText = CREDENTIAL_MANIFEST_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url);
    const manifest = (await import('../lib/manifest.mjs')).parseManifest(manifestText);
    const generated = generateCredential();
    await writeCredentialStore(join(dir, '.creamlon', 'credentials.json'), {
      version: '1',
      credentials: [{
        credential_id: generated.credential_id,
        secret: generated.secret,
        capability_id: 'echo',
        status: 'available',
        created_at: '2026-06-14T00:00:00Z',
        expires: null,
      }],
    });
    const outputFile = join(dir, 'out.txt');
    await writeFile(outputFile, 'paid result', 'utf8');

    installMockFetch((url, init) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: manifestText };
      }
      if (url.endsWith('/issues') && init?.method === 'POST') {
        const body = JSON.parse(init.body);
        issueBody = body.body;
        return {
          status: 201,
          body: { number: 91, html_url: 'https://github.com/o/r/issues/91', title: body.title },
        };
      }
      if (url.endsWith('/issues/91')) {
        if (init?.method === 'PATCH') {
          issueState = 'closed';
          calls.push('close');
          return { status: 200, body: { number: 91, state: 'closed' } };
        }
        return {
          status: 200,
          body: { number: 91, body: issueBody, title: '[task] echo', state: issueState },
        };
      }
      if (url.includes('/issues/91/comments?')) return { status: 200, body: [] };
      if (url.endsWith('/issues/91/comments') && init?.method === 'POST') {
        calls.push(JSON.parse(init.body).body);
        return { status: 201, body: { id: 1 } };
      }
      return { status: 404, body: { message: 'not found' } };
    });

    try {
      await runCli([
        'submit', 'owner/repo',
        '--capability-id', 'echo',
        '--media-type', 'text/plain',
        '--input', 'paid input',
        '--requester', 'github:alice/caller',
        '--request-id', 'req-paid-cli',
        '--expires', '2099-01-01T00:00:00Z',
        '--credential', generated.value,
        '--token', 'test-token',
      ]);
      assert.ok(issueBody);
      assert.doesNotMatch(issueBody, new RegExp(generated.secret));
      assert.equal(parseTask(issueBody).credential.credential_id, generated.credential_id);

      const deliverArgs = [
        'deliver', 'owner/repo', '91',
        '--repo-path', dir,
        '--output-file', outputFile,
        '--token', 'test-token',
      ];
      await runCli(deliverArgs);
      await runCli([...deliverArgs, '--resume']);
    } finally {
      resetFetch();
    }

    const redemptions = await loadRedemptions(join(dir, 'trust', 'redemptions.log'));
    assert.equal(redemptions.length, 1);
    assert.equal(redemptions[0].credential_id, generated.credential_id);
    const proof = JSON.parse((await readFile(join(dir, 'trust', 'proofs.log'), 'utf8')).trim());
    assert.match(proof.credential_digest, /^sha256:/);
    assert.match(proof.task_intent_digest, /^sha256:/);
    assert.ok(calls.some((item) => typeof item === 'string' && item.includes('credential_digest')));

    const replay = {
      version: '1',
      request_id: 'req-paid-replay',
      capability_id: 'echo',
      requester: 'github:alice/caller',
      input: { media_type: 'text/plain', value: 'another input' },
      expires: '2099-01-01T00:00:00Z',
    };
    replay.credential = authorizeCredential(replay, manifest, generated.value);
    const { validateTaskAcceptance } = await import('../lib/acceptance.mjs');
    const { loadCredentialStore } = await import('../lib/credential.mjs');
    const rejected = validateTaskAcceptance(replay, { title: '[task] echo', state: 'open' }, {
      manifest,
      credentialStore: await loadCredentialStore(join(dir, '.creamlon', 'credentials.json')),
      redemptions,
      checkIssueMeta: true,
    });
    assert.ok(rejected.errors.includes('credential already redeemed'));
  } finally {
    resetFetch();
    await rm(dir, { recursive: true, force: true });
  }
});

test('deliver dry-run signs proof from mocked issue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-deliver-'));
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    const outFile = join(dir, 'out.txt');
    await writeFile(outFile, 'result body', 'utf8');

    const issueBody = taskYaml({ requestId: 'req-deliver-1' });

    installMockFetch((url, init) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
      }
      if (url.endsWith('/issues/42') && !url.includes('/comments')) {
        return { status: 200, body: { number: 42, body: issueBody, title: '[task] echo', state: 'open' } };
      }
      return { status: 404, body: { message: 'not found' } };
    });

    try {
      await runCli([
        'deliver', 'owner/repo', '42',
        '--repo-path', dir,
        '--output-file', outFile,
        '--key', join(dir, '.creamlon', 'private.key'),
        ...NODE_AUTHORIZATION_ARGS,
        '--token', 'test-token',
        '--dry-run',
        '--pretty',
      ]);
    } finally {
      resetFetch();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deliver rejects a tampered authorization', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-deliver-paid-'));
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    const outFile = join(dir, 'out.txt');
    await writeFile(outFile, 'result body', 'utf8');

    const issueBody = taskYaml({ requestId: 'req-deliver-paid' })
      .replace('  value: hello', '  value: tampered');

    installMockFetch((url) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
      }
      if (url.endsWith('/issues/55')) {
        return { status: 200, body: { number: 55, body: issueBody, title: '[task] echo', state: 'open' } };
      }
      return { status: 404, body: { message: 'not found' } };
    });

    try {
      await assert.rejects(
        () => runCli([
          'deliver', 'owner/repo', '55',
          '--repo-path', dir,
          '--output-file', outFile,
          '--key', join(dir, '.creamlon', 'private.key'),
          ...NODE_AUTHORIZATION_ARGS,
          '--token', 'test-token',
        ]),
        (err) => err.message.includes('invalid authorization signature'),
      );
    } finally {
      resetFetch();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watch lists pending tasks with validation', async () => {
  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return {
        status: 200,
        body: MANIFEST_YAML.replace('PLACEHOLDER', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      };
    }
    if (url.includes('/issues?')) {
      return {
        status: 200,
        body: [
          {
            number: 1,
            title: '[task] echo',
            body: taskYaml({ requestId: 'r1', input: 'hi' }),
            html_url: 'https://github.com/o/r/issues/1',
          },
          {
            number: 2,
            title: 'not a task',
            body: '',
            html_url: 'https://github.com/o/r/issues/2',
          },
        ],
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  try {
    await runCli(['watch', 'owner/repo', ...NODE_AUTHORIZATION_ARGS, '--token', 't', '--pretty']);
  } finally {
    resetFetch();
  }
});

test('watch accepts only the earliest pending task for a one-time credential', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-watch-credential-claim-'));
  const logs = [];
  const origLog = console.log;
  try {
    const keygen = await generateKeyPair(null);
    const manifestText = CREDENTIAL_MANIFEST_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url);
    const manifest = parseManifest(manifestText);
    const generated = generateCredential();
    await writeCredentialStore(join(dir, '.creamlon', 'credentials.json'), {
      version: '1',
      credentials: [{
        credential_id: generated.credential_id,
        secret: generated.secret,
        capability_id: 'echo',
        status: 'available',
        created_at: '2026-06-17T00:00:00Z',
        expires: null,
      }],
    });

    const first = {
      version: '1',
      request_id: 'req-paid-first',
      capability_id: 'echo',
      requester: 'github:alice/caller',
      input: { media_type: 'text/plain', value: 'first paid input' },
      expires: '2099-01-01T00:00:00Z',
    };
    first.credential = authorizeCredential(first, manifest, generated.value);
    const second = {
      version: '1',
      request_id: 'req-paid-second',
      capability_id: 'echo',
      requester: 'github:alice/caller',
      input: { media_type: 'text/plain', value: 'second paid input' },
      expires: '2099-01-01T00:00:00Z',
    };
    second.credential = authorizeCredential(second, manifest, generated.value);

    installMockFetch((url) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: manifestText };
      }
      if (url.includes('/issues?')) {
        return {
          status: 200,
          body: [
            {
              number: 4,
              title: '[task] echo',
              state: 'open',
              created_at: '2026-06-17T00:02:00Z',
              body: serializeTask(second),
              html_url: 'https://github.com/o/r/issues/4',
            },
            {
              number: 3,
              title: '[task] echo',
              state: 'open',
              created_at: '2026-06-17T00:01:00Z',
              body: serializeTask(first),
              html_url: 'https://github.com/o/r/issues/3',
            },
          ],
        };
      }
      return { status: 404, body: { message: 'not found' } };
    });

    console.log = (message) => logs.push(message);
    await runCli([
      'watch', 'owner/repo',
      '--repo-path', dir,
      '--token', 'test-token',
      '--pretty',
    ]);
  } finally {
    console.log = origLog;
    resetFetch();
    await rm(dir, { recursive: true, force: true });
  }

  const out = JSON.parse(logs.join('\n'));
  assert.equal(out.pending_count, 2);
  assert.equal(out.valid_count, 1);
  assert.equal(out.invalid_count, 1);
  assert.deepEqual(out.tasks.map((task) => task.issue_number), [3, 4]);
  assert.equal(out.tasks[0].valid, true);
  assert.equal(out.tasks[1].valid, false);
  assert.ok(out.tasks[1].errors.includes('credential already claimed by pending task req-paid-first'));
});

test('deliver dry-run output contains proof hashes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-deliver-out-'));
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    const outFile = join(dir, 'out.txt');
    await writeFile(outFile, 'result body', 'utf8');
    const issueBody = taskYaml({ requestId: 'req-deliver-2' });

    installMockFetch((url) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
      }
      if (url.endsWith('/issues/99')) {
        return { status: 200, body: { number: 99, body: issueBody, title: '[task] echo', state: 'open' } };
      }
      return { status: 404, body: { message: 'not found' } };
    });

    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);
    try {
      await runCli([
        'deliver', 'owner/repo', '99',
        '--repo-path', dir,
        '--output-file', outFile,
        '--key', join(dir, '.creamlon', 'private.key'),
        ...NODE_AUTHORIZATION_ARGS,
        '--token', 'test-token',
        '--dry-run',
        '--pretty',
      ]);
    } finally {
      console.log = origLog;
      resetFetch();
    }

    const out = JSON.parse(logs.join('\n'));
    assert.equal(out.proof.request_id, 'req-deliver-2');
    assert.equal(out.proof.input_digest, hashText('hello'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deliver is resumable and idempotent across repeated execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-deliver-idempotent-'));
  const calls = [];
  let issueState = 'open';
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    const outFile = join(dir, 'out.txt');
    await writeFile(outFile, 'result body', 'utf8');
    const issueBody = taskYaml({ requestId: 'req-idempotent' });

    installMockFetch((url, init) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
      }
      if (url.endsWith('/issues/77')) {
        if (init?.method === 'PATCH') {
          issueState = 'closed';
          calls.push('close');
          return { status: 200, body: { number: 77, state: 'closed' } };
        }
        return {
          status: 200,
          body: { number: 77, body: issueBody, title: '[task] echo', state: issueState },
        };
      }
      if (url.includes('/issues/77/comments?')) return { status: 200, body: [] };
      if (url.endsWith('/issues/77/comments') && init?.method === 'POST') {
        calls.push('comment');
        return { status: 201, body: { id: 1 } };
      }
      return { status: 404, body: { message: 'not found' } };
    });

    try {
      const args = [
        'deliver', 'owner/repo', '77',
        '--repo-path', dir,
        '--output-file', outFile,
        '--key', join(dir, '.creamlon', 'private.key'),
        ...NODE_AUTHORIZATION_ARGS,
        '--token', 'test-token',
      ];
      await runCli(args);
      await runCli([...args, '--resume']);
    } finally {
      resetFetch();
    }

    const lines = (await readFile(join(dir, 'trust', 'proofs.log'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(calls, ['comment', 'close']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reject comments and closes issue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-reject-'));
  const calls = [];
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    const issueBody = taskYaml({ requestId: 'req-reject', includeAuthorization: false });

    installMockFetch((url, init) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
      }
      if (url.endsWith('/issues/12') && !url.includes('/comments')) {
        if (init?.method === 'PATCH') {
          calls.push({ type: 'close', body: JSON.parse(init.body) });
          return { status: 200, body: { number: 12, state: 'closed' } };
        }
        return { status: 200, body: { number: 12, body: issueBody, title: '[task] echo', state: 'open' } };
      }
      if (url.endsWith('/issues/12/comments') && init?.method === 'POST') {
        calls.push({ type: 'comment', body: JSON.parse(init.body) });
        return { status: 201, body: { id: 1 } };
      }
      return { status: 404, body: { message: 'not found' } };
    });

    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);
    try {
      await runCli([
        'reject', 'owner/repo', '12',
        '--repo-path', dir,
        ...NODE_AUTHORIZATION_ARGS,
        '--token', 'test-token',
        '--pretty',
      ]);
    } finally {
      console.log = origLog;
      resetFetch();
    }

    assert.ok(calls.some((c) => c.type === 'comment'));
    assert.ok(calls.some((c) => c.type === 'close'));
    const out = JSON.parse(logs.join('\n'));
    assert.equal(out.ok, true);
    assert.ok(out.reason.includes('missing authorization'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fetch-proof extracts and verifies proof from comments', async () => {
  const oldKeys = await generateKeyPair(null);
  const currentKeys = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-fetch',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, oldKeys.privateKey);
  const rotation = signKeyRotation({
    oldPublicKey: oldKeys.publicKeyBase64Url,
    newPublicKey: currentKeys.publicKeyBase64Url,
    rotatedAt: '2026-06-14T00:00:00.000Z',
  }, oldKeys.privateKey);
  const commentBody = `Creamlon delivery proof:\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\``;

  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', currentKeys.publicKeyBase64Url) };
    }
    if (url.includes('/contents/trust/key-rotations.log')) {
      return {
        status: 200,
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(`${JSON.stringify(rotation)}\n`).toString('base64'),
        },
      };
    }
    if (url.endsWith('/issues/88')) {
      return {
        status: 200,
        body: {
          number: 88,
          title: '[task] echo',
          state: 'closed',
          body: taskYaml({ requestId: 'req-fetch', input: 'in' }),
        },
      };
    }
    if (url.includes('/issues/88/comments?')) {
      return {
        status: 200,
        body: [{
          id: 1,
          created_at: '2026-06-13T12:00:00Z',
          author_association: 'OWNER',
          body: commentBody,
        }],
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    await runCli([
      'fetch-proof', 'owner/repo', '88',
      '--verify',
      '--token', 'test-token',
      '--pretty',
    ]);
  } finally {
    console.log = origLog;
    resetFetch();
  }

  const out = JSON.parse(logs.join('\n'));
  assert.equal(out.ok, true);
  assert.equal(out.proof.request_id, 'req-fetch');
  assert.equal(out.verify.ok, true);
  assert.equal(out.key_continuity, 'self_consistent');
});

test('verify loads public key rotations without a GitHub token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-anonymous-verify-'));
  const oldKeys = await generateKeyPair(null);
  const currentKeys = await generateKeyPair(null);
  const proof = signProof(buildProofFields({
    requestId: 'req-anonymous-verify',
    capabilityId: 'echo',
    inputDigest: hashText('in'),
    outputDigest: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  }), oldKeys.privateKey);
  const rotation = signKeyRotation({
    oldPublicKey: oldKeys.publicKeyBase64Url,
    newPublicKey: currentKeys.publicKeyBase64Url,
    rotatedAt: '2026-06-14T00:00:00.000Z',
  }, oldKeys.privateKey);
  const proofPath = join(dir, 'proof.json');
  await writeFile(proofPath, `${JSON.stringify(proof)}\n`, 'utf8');
  const requests = [];
  installMockFetch((url, init = {}) => {
    requests.push({ url, authorization: init.headers?.Authorization });
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: FREE_MANIFEST_YAML.replace('PLACEHOLDER', currentKeys.publicKeyBase64Url) };
    }
    if (url.includes('/contents/trust/key-rotations.log')) {
      return {
        status: 200,
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(`${JSON.stringify(rotation)}\n`).toString('base64'),
        },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });
  const logs = [];
  const originalLog = console.log;
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  console.log = (message) => logs.push(message);
  try {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    await runCli([
      'verify',
      '--repo', 'owner/repo',
      '--proof', proofPath,
      '--pretty',
    ]);
  } finally {
    restoreEnv('GITHUB_TOKEN', originalGithubToken);
    restoreEnv('GH_TOKEN', originalGhToken);
    console.log = originalLog;
    resetFetch();
    await rm(dir, { recursive: true, force: true });
  }
  const out = JSON.parse(logs.join('\n'));
  assert.equal(out.ok, true);
  assert.equal(out.key_continuity, 'self_consistent');
  assert.ok(requests.some((request) => request.url.includes('/contents/trust/key-rotations.log')));
  assert.ok(requests.every((request) => request.authorization == null));
});

test('hmac-key-new creates a private HMAC authorization key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-hmac-key-'));
  try {
    const keysPath = join(dir, 'authorization.keys.json');
    await runCli(['hmac-key-new', '--key-id', 'customer-1', '--out', keysPath]);
    const keys = JSON.parse(await readFile(keysPath, 'utf8'));
    assert.match(keys['customer-1'], /^[A-Za-z0-9_-]+$/);
    await import('node:fs/promises').then((fs) => fs.chmod(keysPath, 0o644));
    await runCli(['hmac-key-new', '--key-id', 'customer-2', '--out', keysPath]);
    const mode = await import('node:fs/promises').then((fs) => fs.stat(keysPath));
    assertPrivateMode(mode.mode);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('GitHub discovery API searches the required topic and reads repository files', async () => {
  const urls = [];
  installMockFetch((url) => {
    urls.push(url);
    if (url.includes('/search/repositories?')) {
      return {
        status: 200,
        body: { items: [{ full_name: 'owner/node' }] },
      };
    }
    if (url.includes('/repos/owner/node/contents/creamlon.yaml')) {
      return {
        status: 200,
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('name: node\n').toString('base64'),
        },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });
  try {
    const repos = await searchRepositories({ limit: 10 });
    const text = await getRepositoryFile('owner', 'node', 'creamlon.yaml', 'main');
    assert.equal(repos[0].full_name, 'owner/node');
    assert.equal(text, 'name: node\n');
    assert.ok(urls.some((url) => url.includes('q=topic%3Acreamlon-node+is%3Apublic')));
    assert.ok(urls.some((url) => url.includes('ref=main')));
  } finally {
    resetFetch();
  }
});

test('optional GitHub repository files return null when missing', async () => {
  installMockFetch(() => ({ status: 404, body: { message: 'not found' } }));
  try {
    const text = await getRepositoryFile(
      'owner',
      'node',
      'trust/status.json',
      'main',
      null,
      { optional: true },
    );
    assert.equal(text, null);
  } finally {
    resetFetch();
  }
});

test('GitHub repository file paths encode URL delimiters by segment', async () => {
  const urls = [];
  installMockFetch((url) => {
    urls.push(url);
    return {
      status: 200,
      body: {
        type: 'file',
        encoding: 'base64',
        content: Buffer.from('ok').toString('base64'),
      },
    };
  });
  try {
    await getRepositoryFile('owner', 'node', 'tasks/a?b#c%/input.enc', 'main');
    assert.ok(urls[0].includes('/contents/tasks/a%3Fb%23c%25/input.enc?ref=main'));
  } finally {
    resetFetch();
  }
});

test('inspect reports an invalid public key without crashing', async () => {
  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: MANIFEST_YAML.replace('PLACEHOLDER', 'invalid-key') };
    }
    return { status: 404, body: { message: 'not found' } };
  });
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(message);
  try {
    await runCli(['inspect', 'owner/node', '--pretty']);
  } finally {
    console.log = originalLog;
    resetFetch();
  }
  const result = JSON.parse(logs.join('\n'));
  assert.equal(result.valid, false);
  assert.equal(result.public_key_fingerprint, null);
  assert.ok(result.errors.includes('invalid identity.public_key'));
});

test('inspect --trust fetches trust status and key continuity', async () => {
  const { publicKeyBase64Url } = await generateKeyPair(null);
  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: FREE_MANIFEST_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    if (url.includes('/contents/trust/status.json')) {
      return {
        status: 200,
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(JSON.stringify({ status: 'available', proofs_valid: true })).toString('base64'),
        },
      };
    }
    if (url.includes('/contents/trust/key-rotations.log')) {
      return { status: 404, body: { message: 'not found' } };
    }
    return { status: 404, body: { message: 'not found' } };
  });
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(message);
  try {
    await runCli(['inspect', 'owner/node', '--trust', '--pretty']);
  } finally {
    console.log = originalLog;
    resetFetch();
  }
  const result = JSON.parse(logs.join('\n'));
  assert.equal(result.trust_status.status, 'available');
  assert.equal(result.key_continuity, 'unverified');
});

test('tasks lists task issues and cancel closes a task issue', async () => {
  const { publicKeyBase64Url } = await generateKeyPair(null);
  const task = parseTask(taskYaml({ requestId: 'req-task-list', includeAuthorization: false }));
  const issueBody = serializeTask(task);
  const calls = [];
  installMockFetch((url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body && JSON.parse(init.body) });
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: FREE_MANIFEST_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    if (path === '/repos/owner/node/issues' && url.includes('state=all')) {
      return {
        status: 200,
        body: [{
          number: 5,
          html_url: 'https://github.com/owner/node/issues/5',
          title: '[task] echo',
          body: issueBody,
          state: 'open',
          created_at: '2026-06-14T00:00:00Z',
          updated_at: '2026-06-14T00:00:00Z',
        }],
      };
    }
    if (path === '/repos/owner/node/issues/5' && (init.method || 'GET') === 'GET') {
      return {
        status: 200,
        body: {
          number: 5,
          html_url: 'https://github.com/owner/node/issues/5',
          title: '[task] echo',
          body: issueBody,
          state: 'open',
        },
      };
    }
    if (path === '/repos/owner/node/issues/5/comments' && init.method === 'POST') {
      return { status: 201, body: { id: 1 } };
    }
    if (path === '/repos/owner/node/issues/5' && init.method === 'PATCH') {
      return { status: 200, body: { number: 5, state: 'closed' } };
    }
    return { status: 404, body: { message: 'not found' } };
  });
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(message);
  try {
    await runCli(['tasks', 'owner/node', '--requester', 'github:alice/caller', '--pretty']);
    await runCli([
      'cancel', 'owner/node', '5',
      '--requester', 'github:alice/caller',
      '--reason', 'no longer needed',
      '--token', 'test-token',
      '--pretty',
    ]);
  } finally {
    console.log = originalLog;
    resetFetch();
  }
  const taskList = JSON.parse(logs[0]);
  assert.equal(taskList.count, 1);
  assert.equal(taskList.tasks[0].request_id, 'req-task-list');
  const cancel = JSON.parse(logs[1]);
  assert.equal(cancel.ok, true);
  assert.equal(cancel.requester, 'github:alice/caller');
  assert.ok(calls.some((call) => call.method === 'PATCH'));
});

test('cancel validates requester before closing a task issue', async () => {
  const task = parseTask(taskYaml({ requestId: 'req-cancel-guard', includeAuthorization: false }));
  const issueBody = serializeTask(task);
  const calls = [];
  installMockFetch((url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || 'GET' });
    if (path === '/repos/owner/node/issues/5') {
      return {
        status: 200,
        body: {
          number: 5,
          html_url: 'https://github.com/owner/node/issues/5',
          title: '[task] echo',
          body: issueBody,
          state: 'open',
        },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });
  try {
    await assert.rejects(
      () => runCli(['cancel', 'owner/node', '5', '--token', 'test-token']),
      /cancel requires --requester/,
    );
    await assert.rejects(
      () => runCli([
        'cancel', 'owner/node', '5',
        '--requester', 'github:bob/caller',
        '--token', 'test-token',
      ]),
      /task requester does not match/,
    );
  } finally {
    resetFetch();
  }
  assert.ok(!calls.some((call) => call.method === 'PATCH' || call.method === 'POST'));
});

test('credential show prints the complete credential and gc removes redeemed or expired records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-credential-cli-'));
  try {
    const storePath = join(dir, '.creamlon', 'credentials.json');
    const redemptionsPath = join(dir, 'trust', 'redemptions.log');
    const first = generateCredential();
    const second = generateCredential();
    await writeCredentialStore(storePath, {
      version: '1',
      credentials: [
        {
          credential_id: first.credential_id,
          secret: first.secret,
          capability_id: 'echo',
          status: 'available',
          created_at: '2026-06-14T00:00:00Z',
          expires: null,
        },
        {
          credential_id: second.credential_id,
          secret: second.secret,
          capability_id: 'echo',
          status: 'available',
          created_at: '2026-06-14T00:00:00Z',
          expires: '2000-01-01T00:00:00Z',
        },
      ],
    });
    await mkdir(join(dir, 'trust'), { recursive: true });
    await writeFile(redemptionsPath, `${JSON.stringify({
      version: '1',
      request_id: 'req-redeemed',
      credential_id: first.credential_id,
      credential_digest: `sha256:${'a'.repeat(64)}`,
      task_intent_digest: `sha256:${'b'.repeat(64)}`,
      capability_id: 'echo',
      redeemed_at: '2026-06-14T00:00:00Z',
    })}\n`, 'utf8');

    const logs = [];
    const originalLog = console.log;
    console.log = (message) => logs.push(message);
    try {
      await runCli([
        'credential', 'show', first.credential_id,
        '--repo-path', dir,
        '--credentials', storePath,
        '--pretty',
      ]);
      await runCli([
        'credential', 'gc',
        '--repo-path', dir,
        '--credentials', storePath,
        '--pretty',
      ]);
    } finally {
      console.log = originalLog;
    }
    assert.equal(JSON.parse(logs[0]).credential, first.value);
    assert.equal(JSON.parse(logs[1]).removed_count, 2);
    const remaining = JSON.parse(await readFile(storePath, 'utf8'));
    assert.deepEqual(remaining.credentials, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
