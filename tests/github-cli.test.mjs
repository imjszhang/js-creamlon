import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../cli/index.mjs';
import { setGithubFetch } from '../lib/github.mjs';
import { setAgentFetch } from '../lib/agentYaml.mjs';
import { hashText } from '../lib/hash.mjs';
import { buildProofFields, signProof, generateKeyPair } from '../lib/proof.mjs';

const AGENT_YAML = `name: mock-node
description: Mock
creamlon:
  version: "0.2"
  public_key: PLACEHOLDER
  capabilities:
    - id: echo
      description: Echo
`;

const PAID_AGENT_YAML = `name: paid-node
description: Paid
creamlon:
  version: "0.3"
  public_key: PLACEHOLDER
  payment_required: true
  payment_instructions: Contact operator for token
  payment:
    type: token
  capabilities:
    - id: echo
      description: Echo
`;

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
      '--token', 'test-token',
    ]);
  } finally {
    resetFetch();
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, '[task] echo');
  assert.match(calls[0].body, /req-submit-1/);
});

test('submit paid node requires payment json', async () => {
  const { publicKeyBase64Url } = await generateKeyPair(null);

  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: PAID_AGENT_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
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
      (err) => err.message.includes('missing payment'),
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

    const issueBody = `request_id: req-deliver-1
capability_id: echo
input: hello
requester: github:alice/caller
`;

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

test('deliver rejects invalid payment on paid node', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-deliver-paid-'));
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    await writeFile(join(dir, '.creamlon', 'payment.token'), 'node-secret\n', 'utf8');
    const outFile = join(dir, 'out.txt');
    await writeFile(outFile, 'result body', 'utf8');

    const issueBody = `request_id: req-deliver-paid
capability_id: echo
input: hello
requester: github:alice/caller
payment:
  type: token
  token: wrong-token
  request_id: req-deliver-paid
`;

    installMockFetch((url) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: PAID_AGENT_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
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
          '--token', 'test-token',
        ]),
        (err) => err.message.includes('invalid payment token'),
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
        body: AGENT_YAML.replace('PLACEHOLDER', 'dGVzdA'),
      };
    }
    if (url.includes('/issues?')) {
      return {
        status: 200,
        body: [
          {
            number: 1,
            title: '[task] echo',
            body: 'request_id: r1\ncapability_id: echo\ninput: hi\nrequester: github:a/b\n',
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
    await runCli(['watch', 'owner/repo', '--token', 't', '--pretty']);
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
    const issueBody = `request_id: req-deliver-2
capability_id: echo
input: hello
requester: github:alice/caller
`;

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

test('reject comments and closes issue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-reject-'));
  const calls = [];
  try {
    const keygen = await generateKeyPair(join(dir, '.creamlon'));
    await writeFile(join(dir, '.creamlon', 'payment.token'), 'node-secret\n', 'utf8');

    const issueBody = `request_id: req-reject
capability_id: echo
input: hello
requester: github:alice/caller
`;

    installMockFetch((url, init) => {
      if (url.includes('raw.githubusercontent.com')) {
        return { status: 200, body: PAID_AGENT_YAML.replace('PLACEHOLDER', keygen.publicKeyBase64Url) };
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
  const { publicKeyBase64Url, privateKey } = await generateKeyPair(null);
  const fields = buildProofFields({
    requestId: 'req-fetch',
    capabilityId: 'echo',
    inputHash: hashText('in'),
    outputHash: hashText('out'),
    completedAt: '2026-06-13T00:00:00.000Z',
  });
  const proof = signProof(fields, privateKey);
  const commentBody = `Creamlon delivery proof:\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\``;

  installMockFetch((url) => {
    if (url.includes('raw.githubusercontent.com')) {
      return { status: 200, body: AGENT_YAML.replace('PLACEHOLDER', publicKeyBase64Url) };
    }
    if (url.endsWith('/issues/88/comments')) {
      return {
        status: 200,
        body: [{ id: 1, created_at: '2026-06-13T12:00:00Z', body: commentBody }],
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
});

test('token-new writes payment token file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-token-new-'));
  try {
    const outPath = join(dir, '.creamlon', 'payment.token');
    await runCli(['token-new', '--out', outPath]);
    const content = await readFile(outPath, 'utf8');
    assert.match(content.trim(), /^[0-9a-f]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
