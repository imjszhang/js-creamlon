import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';

export const DELIVERY_SCHEME = 'hpke-x25519-aes256gcm-v1';
const HKDF_INFO = Buffer.from('creamlon-delivery-v1', 'utf8');
const IV_BYTES = 12;
const TAG_BYTES = 16;

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

export function seal(plaintext, recipientPublicKeyB64) {
  const ephemeral = generateKeyPairSync('x25519');
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: publicKeyFromB64(recipientPublicKeyB64),
  });
  const key = deriveAesKey(shared);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: 1,
    scheme: DELIVERY_SCHEME,
    ephemeral_public_key: toBase64Url(ephemeral.publicKey.export({ type: 'spki', format: 'der' })),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(Buffer.concat([encrypted, tag])),
  });
}

export function open(sealedJson, recipientPrivateKeyB64) {
  const parsed = typeof sealedJson === 'string' ? JSON.parse(sealedJson) : sealedJson;
  if (parsed?.scheme !== DELIVERY_SCHEME) throw new Error('unsupported delivery ciphertext scheme');
  const ephemeralPublic = publicKeyFromB64(parsed.ephemeral_public_key);
  const iv = fromBase64Url(parsed.iv);
  const payload = fromBase64Url(parsed.ciphertext);
  if (payload.length < TAG_BYTES) throw new Error('invalid delivery ciphertext');
  const shared = diffieHellman({
    privateKey: privateKeyFromB64(recipientPrivateKeyB64),
    publicKey: ephemeralPublic,
  });
  const key = deriveAesKey(shared);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const encrypted = payload.subarray(0, payload.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
