import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../cli/index.mjs';
import {
  getRepositoryFile,
  searchRepositories,
  setGithubFetch,
} from '../lib/github.mjs';
import { setAgentFetch } from '../lib/agentYaml.mjs';
import { hashText } from '../lib/hash.mjs';
import { buildProofFields, signProof, generateKeyPair } from '../lib/proof.mjs';
import { signHmacPayment } from '../lib/payment.mjs';
import { serializeTaskYaml } from '../lib/taskYaml.mjs';
import { signKeyRotation } from '../lib/identity.mjs';

const AGENT_YAML = `name: mock-node
description: Mock
creamlon:
  version: "0.3.1"
  public_key: PLACEHOLDER
  status: available
  payment_instructions: Contact operator
  capabilities:
    - id: echo
      description: Echo
      input_types: [text/plain]
      output_types: [text/plain]
`;

const PAYMENT_KEY_ID = 'customer-1';
const PAYMENT_SECRET = 'node-secret';
const PAYMENT_EXPIRES = '2099-01-01T00:00:00Z';
const PAYMENT_DIR = await mkdtemp(join(tmpdir(), 'creamlon-test-keys-'));
const PAYMENT_KEYS_PATH = join(PAYMENT_DIR, 'payment.keys.json');
await writeFile(PAYMENT_KEYS_PATH, `${JSON.stringify({ [PAYMENT_KEY_ID]: PAYMENT_SECRET })}\n`, 'utf8');
after(() => rm(PAYMENT_DIR, { recursive: true, force: true }));

function taskYaml({ requestId, input = 'hello', includePayment = true }) {
  const task = {
    request_id: requestId,
    capability_id: 'echo',
    requester: 'github:alice/caller',
    input,
    input_hash: null,
    input_ref: null,
    expires: null,
    payment: null,
  };
  if (includePayment) {
    task.payment = signHmacPayment(task, {
      keyId: PAYMENT_KEY_ID,
      secret: PAYMENT_SECRET,
      expires: PAYMENT_EXPIRES,
    });
  }
  return serializeTaskYaml(task);
}

const PAYMENT_ARGS = [
  '--payment-key-id', PAYMENT_KEY_ID,
  '--keys', PAYMENT_KEYS_PATH,
  '--payment-expires', PAYMENT_EXPIRES,
];

const NODE_PAYMENT_ARGS = [
  '--keys', PAYMENT_KEYS_PATH,
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
  setAgentFetch(fetchFn);
}

function resetFetch() {
  setGithubFetch(globalThis.fetch);
  setAgentFetch(globalThis.fetch);
}

test('submit creates issue via mocked GitHub API', async () => {
  const calls = [];
  const { generateKeyPair: gen } = await import('../lib/proof.mjs');
  const { publicKeyBase64Url } = await gen(null);

  installMockFetch((url, init) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
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
      '--requester', 'github:alice/caller',
      '--request-id', 'req-submit-1',
      ...PAYMENT_ARGS,
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
      return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  try {
    await assert.rejects(
      () => runCli([
        'submit', 'owner/repo',
        '--capability-id', 'echo',
        '--input', 'hello',
        '--requester', 'github:alice/caller',
        '--token', 'test-token',
      ]),
      (err) => err.message.includes('--payment-key-id'),
    );
  } finally {
    resetFetch();
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
        return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
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
        ...NODE_PAYMENT_ARGS,
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

test('deliver rejects a tampered payment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-deliver-paid-'));
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    const outFile = join(dir, 'out.txt');
    await writeFile(outFile, 'result body', 'utf8');

    const issueBody = taskYaml({ requestId: 'req-deliver-paid' }).replace('input: hello', 'input: tampered');

    installMockFetch((url) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
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
          ...NODE_PAYMENT_ARGS,
          '--token', 'test-token',
        ]),
        (err) => err.message.includes('invalid payment signature'),
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
        body: AGENT_YAML.replace('PLACEHOLDER', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
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
    await runCli(['watch', 'owner/repo', ...NODE_PAYMENT_ARGS, '--token', 't', '--pretty']);
  } finally {
    resetFetch();
  }
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
        return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
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
        ...NODE_PAYMENT_ARGS,
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
    assert.equal(out.proof.input_hash, hashText('hello'));
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
        return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
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
        ...NODE_PAYMENT_ARGS,
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
    const issueBody = taskYaml({ requestId: 'req-reject', includePayment: false });

    installMockFetch((url, init) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
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
        ...NODE_PAYMENT_ARGS,
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
    assert.ok(out.reason.includes('missing payment'));
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
    inputHash: hashText('in'),
    outputHash: hashText('out'),
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
      return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', currentKeys.publicKeyBase64Url) };
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

test('payment-key-new creates a private HMAC key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-hmac-key-'));
  try {
    const keysPath = join(dir, 'payment.keys.json');
    await runCli(['payment-key-new', '--key-id', 'customer-1', '--out', keysPath]);
    const keys = JSON.parse(await readFile(keysPath, 'utf8'));
    assert.match(keys['customer-1'], /^[A-Za-z0-9_-]+$/);
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
    if (url.includes('/repos/owner/node/contents/agent.yaml')) {
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
    const repos = await searchRepositories({ token: 'test-token', limit: 10 });
    const text = await getRepositoryFile('owner', 'node', 'agent.yaml', 'main', 'test-token');
    assert.equal(repos[0].full_name, 'owner/node');
    assert.equal(text, 'name: node\n');
    assert.ok(urls.some((url) => url.includes('q=topic%3Acreamlon-node+is%3Apublic')));
    assert.ok(urls.some((url) => url.includes('ref=main')));
  } finally {
    resetFetch();
  }
});

test('inspect reports an invalid public key without crashing', async () => {
  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', 'invalid-key') };
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
  assert.ok(result.errors.includes('invalid creamlon.public_key'));
});
