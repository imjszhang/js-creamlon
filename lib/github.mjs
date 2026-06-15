let transportFetch = globalThis.fetch;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function setGithubFetch(fn) {
  transportFetch = fn;
}

export function getGithubToken(explicit) {
  return explicit || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function requireToken(token, method) {
  if (!token && method !== 'GET') {
    const err = new Error('GitHub token required (set GITHUB_TOKEN or GH_TOKEN, or pass --token)');
    err.exitCode = 1;
    throw err;
  }
  return token;
}

async function githubRequest(path, { method = 'GET', token, body, retries = 2 } = {}) {
  const auth = requireToken(token, method);
  const apiBase = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  let res;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      res = await transportFetch(`${apiBase}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt === retries) {
        const wrapped = new Error(error.name === 'AbortError'
          ? 'GitHub request timed out'
          : `GitHub request failed: ${error.message}`);
        wrapped.exitCode = 3;
        throw wrapped;
      }
    } finally {
      clearTimeout(timer);
    }
    if (res && (!RETRYABLE_STATUS.has(res.status) || attempt === retries)) break;
    await new Promise((resolve) => setTimeout(resolve, 100 * (2 ** attempt)));
  }

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
    err.exitCode = 3;
    throw err;
  }

  return data;
}

function friendlyGithubError(status, msg) {
  if (status === 401) return `GitHub auth failed: ${msg} (check GITHUB_TOKEN or GH_TOKEN)`;
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
  const all = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ state, per_page: '100', page: String(page) });
    if (since) params.set('since', since);
    const batch = await githubRequest(`/repos/${owner}/${repo}/issues?${params}`, { token });
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

export async function getIssue(owner, repo, issueNumber, token) {
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, { token });
}

export async function getIssueComments(owner, repo, issueNumber, token) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      { token },
    );
    all.push(...batch);
    if (batch.length < 100) return all;
  }
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

export async function getAuthenticatedUser(token) {
  return githubRequest('/user', { token });
}

export async function getUser(username, token) {
  return githubRequest(`/users/${encodeURIComponent(username)}`, { token });
}

export async function getRepository(owner, repo, token) {
  return githubRequest(`/repos/${owner}/${repo}`, { token });
}

export async function createPrivateRepository(owner, name, token) {
  const user = await getAuthenticatedUser(token);
  const path = user.login.toLowerCase() === owner.toLowerCase()
    ? '/user/repos'
    : `/orgs/${owner}/repos`;
  return githubRequest(path, {
    method: 'POST',
    token,
    body: {
      name,
      private: true,
      auto_init: true,
      description: 'Private Creamlon delivery inbox',
    },
  });
}

export async function addRepositoryCollaborator(owner, repo, username, token, permission = null) {
  return githubRequest(`/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`, {
    method: 'PUT',
    token,
    body: permission ? { permission } : {},
  });
}

export async function removeRepositoryCollaborator(owner, repo, username, token) {
  return githubRequest(`/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    token,
  });
}

export async function getRepositoryCollaboratorPermission(owner, repo, username, token) {
  return githubRequest(
    `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}/permission`,
    { token },
  );
}

const INBOX_RULESET_PREFIX = 'Creamlon inbox integrity';

export async function getBranchRules(owner, repo, branch, token) {
  return githubRequest(
    `/repos/${owner}/${repo}/rules/branches/${encodeURIComponent(branch)}`,
    { token },
  );
}

export async function ensureInboxRuleset(owner, repo, branch, token) {
  const name = `${INBOX_RULESET_PREFIX}: ${branch}`;
  const rulesets = await githubRequest(
    `/repos/${owner}/${repo}/rulesets?includes_parents=false&per_page=100`,
    { token },
  );
  const existing = rulesets.find((ruleset) => ruleset.name === name);
  const body = {
    name,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: [`refs/heads/${branch}`],
        exclude: [],
      },
    },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
    ],
  };
  if (existing) {
    return githubRequest(`/repos/${owner}/${repo}/rulesets/${existing.id}`, {
      method: 'PUT',
      token,
      body,
    });
  }
  return githubRequest(`/repos/${owner}/${repo}/rulesets`, {
    method: 'POST',
    token,
    body,
  });
}

export async function searchRepositories({ topic = 'creamlon-node', limit = 100, token }) {
  const items = [];
  const max = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  for (let page = 1; items.length < max; page += 1) {
    const perPage = Math.min(100, max - items.length);
    const params = new URLSearchParams({
      q: `topic:${topic} is:public archived:false fork:false`,
      per_page: String(perPage),
      page: String(page),
    });
    const result = await githubRequest(`/search/repositories?${params}`, { token });
    items.push(...(result.items || []));
    if ((result.items || []).length < perPage) break;
  }
  return items.slice(0, max);
}

export async function getRepositoryFile(owner, repo, path, ref, token, options = {}) {
  const buffer = await getRepositoryFileBinary(owner, repo, path, ref, token, options);
  if (buffer == null) return null;
  return buffer.toString('utf8');
}

export async function getRepositoryFileBinary(owner, repo, path, ref, token, options = {}) {
  const params = new URLSearchParams();
  if (ref) params.set('ref', ref);
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  try {
    const data = await githubRequest(
      `/repos/${owner}/${repo}/contents/${encodedPath}${params.size ? `?${params}` : ''}`,
      { token },
    );
    if (data?.type !== 'file' || typeof data.content !== 'string') {
      throw new Error(`GitHub path is not a file: ${owner}/${repo}/${path}`);
    }
    return Buffer.from(data.content.replace(/\n/g, ''), data.encoding || 'base64');
  } catch (error) {
    if (options.optional && error.status === 404) return null;
    throw error;
  }
}

export async function putRepositoryFileBinary(owner, repo, path, bytes, { token, message, sha, ref } = {}) {
  let existingSha = sha;
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  if (!existingSha) {
    try {
      const params = new URLSearchParams();
      if (ref) params.set('ref', ref);
      const data = await githubRequest(
        `/repos/${owner}/${repo}/contents/${encodedPath}${params.size ? `?${params}` : ''}`,
        { token },
      );
      existingSha = data?.sha;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const result = await githubRequest(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'PUT',
    token,
    body: {
      message: message || `creamlon: update ${path}`,
      content: Buffer.from(bytes).toString('base64'),
      ...(existingSha ? { sha: existingSha } : {}),
      ...(ref ? { branch: ref } : {}),
    },
  });
  if (!result?.commit?.sha) {
    throw new Error(`GitHub file update did not return a commit SHA: ${owner}/${repo}/${path}`);
  }
  return {
    content_sha: result.content?.sha || null,
    commit_sha: result.commit.sha,
  };
}
