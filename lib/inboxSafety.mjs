function normalizeNodeRepo(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(text)) {
    throw new Error(`invalid node repository: ${value || '<missing>'}`);
  }
  return text;
}

function normalizeInboxRepo(value) {
  const text = String(value || '').trim().toLowerCase();
  const match = /^github:([a-z0-9_.-]+\/[a-z0-9_.-]+)$/.exec(text);
  if (!match) {
    throw new Error(`invalid inbox repository: ${value || '<missing>'}`);
  }
  return match[1];
}

export function assertInboxTargetIsNotNodeRepo(node, inboxRepo) {
  const nodeRepo = normalizeNodeRepo(node);
  const inbox = normalizeInboxRepo(inboxRepo);
  if (nodeRepo === inbox) {
    throw new Error(
      `private delivery inbox must be separate from node repository: ${inboxRepo}`,
    );
  }
}
