import { getRepositoryFileBinary, putRepositoryFileBinary } from '../../github.mjs';

export function parseGithubRepo(slug) {
  const match = /^github:([^/]+)\/(.+)$/.exec(String(slug || ''));
  if (!match) throw new Error(`invalid github repo: ${slug}`);
  return { owner: match[1], repo: match[2] };
}

export async function getArtifact({ repo, path, ref, token }) {
  const { owner, repo: name } = parseGithubRepo(repo);
  return getRepositoryFileBinary(owner, name, path, ref, token);
}

export async function putArtifact({ repo, path, bytes, token, message, ref = null }) {
  const { owner, repo: name } = parseGithubRepo(repo);
  return putRepositoryFileBinary(owner, name, path, bytes, { token, message, ref });
}
