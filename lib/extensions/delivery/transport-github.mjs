import { getRepositoryFileBinary, putRepositoryFileBinary } from '../../github.mjs';

export function parseGithubRepo(slug) {
  const match = /^github:([^/]+)\/(.+)$/.exec(String(slug || ''));
  if (!match) throw new Error(`invalid github repo: ${slug}`);
  return { owner: match[1], repo: match[2] };
}

function artifactAccessError(error, { repo, operation }) {
  if (error.status !== 403 && error.status !== 404) return error;
  const wrapped = new Error(
    `cannot ${operation} delivery artifact in ${repo}: ${error.message}; `
      + `ensure this token has ${operation} access to the private repository `
      + '(GitHub may report inaccessible private repositories as 404)',
  );
  wrapped.status = error.status;
  wrapped.exitCode = error.exitCode;
  wrapped.cause = error;
  return wrapped;
}

export async function getArtifact({ repo, path, ref, token }) {
  const { owner, repo: name } = parseGithubRepo(repo);
  try {
    return await getRepositoryFileBinary(owner, name, path, ref, token);
  } catch (error) {
    throw artifactAccessError(error, { repo, operation: 'read' });
  }
}

export async function putArtifact({ repo, path, bytes, token, message, ref = null }) {
  const { owner, repo: name } = parseGithubRepo(repo);
  try {
    return await putRepositoryFileBinary(owner, name, path, bytes, { token, message, ref });
  } catch (error) {
    throw artifactAccessError(error, { repo, operation: 'write' });
  }
}
