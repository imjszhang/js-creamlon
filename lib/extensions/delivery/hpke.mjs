import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';

export const LEGACY_DELIVERY_SCHEME = 'hpke-x25519-aes256gcm-v1';
export const DELIVERY_SCHEME = 'hpke-x25519-hkdf-sha256-aes256gcm-v2';
export const DELIVERY_SCHEMES = new Set([DELIVERY_SCHEME, LEGACY_DELIVERY_SCHEME]);
const HKDF_INFO = Buffer.from('creamlon-delivery-v1', 'utf8');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HASH_BYTES = 32;
const KEM_SUITE_ID = Buffer.concat([Buffer.from('KEM', 'ascii'), i2osp(0x0020, 2)]);
const HPKE_SUITE_ID = Buffer.concat([
  Buffer.from('HPKE', 'ascii'),
  i2osp(0x0020, 2),
  i2osp(0x0001, 2),
  i2osp(0x0002, 2),
]);
const HPKE_VERSION = Buffer.from('HPKE-v1', 'ascii');

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value), 'base64url');
}

function deriveAesKey(sharedSecret) {
  const reader = createHash('sha256');
  reader.update(sharedSecret);
  reader.update(HKDF_INFO);
  return reader.digest();
}

function i2osp(value, length) {
  const out = Buffer.alloc(length);
  out.writeUIntBE(value, 0, length);
  return out;
}

function hkdfExtract(salt, ikm) {
  return createHmac('sha256', salt.length ? salt : Buffer.alloc(HASH_BYTES))
    .update(ikm)
    .digest();
}

function hkdfExpand(prk, info, length) {
  const blocks = [];
  let previous = Buffer.alloc(0);
  for (let counter = 1; Buffer.concat(blocks).length < length; counter += 1) {
    previous = createHmac('sha256', prk)
      .update(previous)
      .update(info)
      .update(Buffer.from([counter]))
      .digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function labeledExtract(salt, suiteId, label, ikm) {
  return hkdfExtract(
    salt,
    Buffer.concat([HPKE_VERSION, suiteId, Buffer.from(label, 'ascii'), ikm]),
  );
}

function labeledExpand(prk, suiteId, label, info, length) {
  return hkdfExpand(
    prk,
    Buffer.concat([
      i2osp(length, 2),
      HPKE_VERSION,
      suiteId,
      Buffer.from(label, 'ascii'),
      info,
    ]),
    length,
  );
}

function rawPublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

function deriveHpkeContext(sharedSecret, info = Buffer.alloc(0)) {
  const pskIdHash = labeledExtract(Buffer.alloc(0), HPKE_SUITE_ID, 'psk_id_hash', Buffer.alloc(0));
  const infoHash = labeledExtract(Buffer.alloc(0), HPKE_SUITE_ID, 'info_hash', info);
  const keyScheduleContext = Buffer.concat([Buffer.from([0]), pskIdHash, infoHash]);
  const secret = labeledExtract(sharedSecret, HPKE_SUITE_ID, 'secret', Buffer.alloc(0));
  return {
    key: labeledExpand(secret, HPKE_SUITE_ID, 'key', keyScheduleContext, 32),
    nonce: labeledExpand(secret, HPKE_SUITE_ID, 'base_nonce', keyScheduleContext, IV_BYTES),
  };
}

function deriveHpkeSharedSecret(sharedSecret, encRaw, recipientRaw) {
  const eaePrk = labeledExtract(Buffer.alloc(0), KEM_SUITE_ID, 'eae_prk', sharedSecret);
  return labeledExpand(
    eaePrk,
    KEM_SUITE_ID,
    'shared_secret',
    Buffer.concat([encRaw, recipientRaw]),
    HASH_BYTES,
  );
}

function publicKeyFromB64(b64) {
  return createPublicKey({ key: fromBase64Url(b64), format: 'der', type: 'spki' });
}

function privateKeyFromB64(b64) {
  return createPrivateKey({ key: fromBase64Url(b64), format: 'der', type: 'pkcs8' });
}

export function generateDeliveryKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    public_key: toBase64Url(publicKey.export({ type: 'spki', format: 'der' })),
    private_key: toBase64Url(privateKey.export({ type: 'pkcs8', format: 'der' })),
  };
}

export function seal(plaintext, recipientPublicKeyB64, scheme = DELIVERY_SCHEME) {
  if (!DELIVERY_SCHEMES.has(scheme)) throw new Error(`unsupported delivery ciphertext scheme: ${scheme}`);
  const ephemeral = generateKeyPairSync('x25519');
  const recipientPublic = publicKeyFromB64(recipientPublicKeyB64);
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientPublic,
  });
  const encRaw = rawPublicKey(ephemeral.publicKey);
  const { key, nonce: iv } = scheme === DELIVERY_SCHEME
    ? deriveHpkeContext(deriveHpkeSharedSecret(shared, encRaw, rawPublicKey(recipientPublic)))
    : { key: deriveAesKey(shared), nonce: randomBytes(IV_BYTES) };
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: 1,
    scheme,
    ephemeral_public_key: toBase64Url(ephemeral.publicKey.export({ type: 'spki', format: 'der' })),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(Buffer.concat([encrypted, tag])),
  });
}

export function open(sealedJson, recipientPrivateKeyB64) {
  const parsed = typeof sealedJson === 'string' ? JSON.parse(sealedJson) : sealedJson;
  if (parsed?.version !== 1 || !DELIVERY_SCHEMES.has(parsed?.scheme)) {
    throw new Error('unsupported delivery ciphertext scheme');
  }
  const ephemeralPublic = publicKeyFromB64(parsed.ephemeral_public_key);
  const iv = fromBase64Url(parsed.iv);
  const payload = fromBase64Url(parsed.ciphertext);
  if (iv.length !== IV_BYTES || payload.length < TAG_BYTES) throw new Error('invalid delivery ciphertext');
  const recipientPrivate = privateKeyFromB64(recipientPrivateKeyB64);
  const shared = diffieHellman({
    privateKey: recipientPrivate,
    publicKey: ephemeralPublic,
  });
  const hpkeContext = parsed.scheme === DELIVERY_SCHEME
    ? deriveHpkeContext(deriveHpkeSharedSecret(
      shared,
      rawPublicKey(ephemeralPublic),
      rawPublicKey(createPublicKey(recipientPrivate)),
    ))
    : null;
  const key = hpkeContext?.key || deriveAesKey(shared);
  const nonce = hpkeContext?.nonce || iv;
  if (parsed.scheme === DELIVERY_SCHEME && !iv.equals(nonce)) {
    throw new Error('invalid delivery ciphertext nonce');
  }
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const encrypted = payload.subarray(0, payload.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
