let transportFetch = globalThis.fetch;

export function setGithubFetch(fn) {
  transportFetch = fn;
}

export function getGithubToken(explicit) {
  return explicit || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function requireToken(token) {
  if (!token) {
    const err = new Error('GITHUB_TOKEN required (set env or pass --token)');
    err.exitCode = 1;
    throw err;
  }
  return token;
}

async function githubRequest(path, { method = 'GET', token, body } = {}) {
  const auth = requireToken(token);
  const res = await transportFetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${auth}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg = typeof data === 'object' && data?.message
      ? data.message
      : `GitHub API ${res.status}`;
    const err = new Error(friendlyGithubError(res.status, msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function friendlyGithubError(status, msg) {
  if (status === 401) return `GitHub auth failed: ${msg} (check GITHUB_TOKEN)`;
  if (status === 403) return `GitHub forbidden: ${msg}`;
  if (status === 404) return `GitHub not found: ${msg}`;
  return `GitHub API error (${status}): ${msg}`;
}

export async function createIssue(owner, repo, title, body, token) {
  return githubRequest(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    token,
    body: { title, body },
  });
}

export async function listIssues(owner, repo, { state = 'open', since, token } = {}) {
  const params = new URLSearchParams({ state, per_page: '100' });
  if (since) params.set('since', since);
  return githubRequest(`/repos/${owner}/${repo}/issues?${params}`, { token });
}

export async function getIssue(owner, repo, issueNumber, token) {
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, { token });
}

export async function getIssueComments(owner, repo, issueNumber, token) {
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { token });
}

export async function createIssueComment(owner, repo, issueNumber, body, token) {
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    token,
    body: { body },
  });
}

export async function closeIssue(owner, repo, issueNumber, token) {
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    token,
    body: { state: 'closed' },
  });
}
