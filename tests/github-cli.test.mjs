import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../cli/index.mjs';
import { setGithubFetch } from '../lib/github.mjs';
import { setAgentFetch } from '../lib/agentYaml.mjs';
import { hashText } from '../lib/hash.mjs';

const AGENT_YAML = `name: mock-node
description: Mock
creamlon:
  version: "0.2"
  public_key: PLACEHOLDER
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
  const { generateKeyPair } = await import('../lib/proof.mjs');
  const { publicKeyBase64Url } = await generateKeyPair(null);

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

test('deliver dry-run signs proof from mocked issue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creamlon-deliver-'));
  try {
    const { generateKeyPair } = await import('../lib/proof.mjs');
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
        return { status: 200, body: { number: 42, body: issueBody, title: '[task] echo' } };
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
    const { generateKeyPair } = await import('../lib/proof.mjs');
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
        return { status: 200, body: { number: 99, body: issueBody, title: '[task] echo' } };
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
