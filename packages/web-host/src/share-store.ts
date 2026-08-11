import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type ShareAssetInput = { name: string; mime: string; data: string };
export type ShareAsset = { id: string; name: string; mime: string; size: number };

type StoredAsset = ShareAsset & { file: string };
type StoredShare = {
  id: string;
  ownerId: string;
  tokenHash: string;
  title: string;
  markdown: string;
  assets: StoredAsset[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export type PublicShare = Omit<StoredShare, 'tokenHash' | 'ownerId' | 'revokedAt' | 'assets'> & {
  assets: ShareAsset[];
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_ASSETS = 64;

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');
const isValidBase64 = (value: string): boolean => {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const normalized = value.replace(/=+$/, '');
  return Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') === normalized;
};
const isSafeImageMime = (value: string): boolean =>
  /^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|tiff)$/i.test(value);

export class ShareStore {
  private readonly metadataFile: string;
  private readonly assetsDir: string;
  private readonly ttlMs: number;
  private readonly maxMarkdownBytes: number;
  private readonly maxAssetBytes: number;
  private shares = new Map<string, StoredShare>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageDir: string,
    options: { ttlMs?: number; maxMarkdownBytes?: number; maxAssetBytes?: number } = {}
  ) {
    this.metadataFile = path.join(storageDir, 'shares.json');
    this.assetsDir = path.join(storageDir, 'assets');
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxMarkdownBytes = options.maxMarkdownBytes ?? MAX_MARKDOWN_BYTES;
    this.maxAssetBytes = options.maxAssetBytes ?? MAX_ASSET_BYTES;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.assetsDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.metadataFile, 'utf8')) as StoredShare[];
      if (Array.isArray(parsed)) this.shares = new Map(parsed.map((share) => [share.id, share]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async create(ownerId: string, input: { markdown: string; title?: string; assets?: ShareAssetInput[]; expiresAt?: string }) {
    if (!input || typeof input.markdown !== 'string' || byteLength(input.markdown) > this.maxMarkdownBytes) {
      throw new ShareStoreError('INVALID_MARKDOWN', 400);
    }
    const assets = input.assets ?? [];
    if (!Array.isArray(assets) || assets.length > MAX_ASSETS) throw new ShareStoreError('INVALID_ASSETS', 400);

    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : now + this.ttlMs;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new ShareStoreError('INVALID_EXPIRY', 400);

    const storedAssets: StoredAsset[] = [];
    for (const asset of assets) {
      if (!asset || typeof asset.name !== 'string' || typeof asset.mime !== 'string' || typeof asset.data !== 'string') {
        throw new ShareStoreError('INVALID_ASSET', 400);
      }
      if (!isValidBase64(asset.data) || !isSafeImageMime(asset.mime)) throw new ShareStoreError('INVALID_ASSET', 400);
      const bytes = Buffer.from(asset.data, 'base64');
      if (!bytes.length || bytes.length > this.maxAssetBytes) {
        throw new ShareStoreError('INVALID_ASSET', 400);
      }
      const assetId = randomUUID();
      const file = path.join(this.assetsDir, `${id}-${assetId}`);
      await fs.writeFile(file, bytes, { flag: 'wx' });
      storedAssets.push({ id: assetId, name: path.basename(asset.name), mime: asset.mime, size: bytes.length, file });
    }

    const share: StoredShare = {
      id,
      ownerId,
      tokenHash: tokenHash(token),
      title: typeof input.title === 'string' ? input.title.slice(0, 200) : 'Shared Markdown',
      markdown: input.markdown,
      assets: storedAssets,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
    this.shares.set(id, share);
    await this.persist();
    return { id, token, title: share.title, createdAt: share.createdAt, expiresAt: share.expiresAt };
  }

  getPublic(token: string): PublicShare | null {
    const share = [...this.shares.values()].find((candidate) => candidate.tokenHash === tokenHash(token));
    if (!share || share.revokedAt || Date.parse(share.expiresAt) <= Date.now()) return null;
    return {
      id: share.id,
      title: share.title,
      markdown: share.markdown,
      assets: share.assets.map(({ file: _file, ...asset }) => asset),
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
    };
  }

  async readAsset(token: string, assetId: string): Promise<{ asset: ShareAsset; data: Buffer } | null> {
    const share = this.getPublic(token);
    if (!share) return null;
    const stored = [...this.shares.values()].find((candidate) => candidate.id === share.id)?.assets.find((asset) => asset.id === assetId);
    if (!stored) return null;
    return { asset: { id: stored.id, name: stored.name, mime: stored.mime, size: stored.size }, data: await fs.readFile(stored.file) };
  }

  async revoke(ownerId: string, id: string): Promise<boolean> {
    const share = this.shares.get(id);
    if (!share || share.ownerId !== ownerId || share.revokedAt) return false;
    share.revokedAt = new Date().toISOString();
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const temp = `${this.metadataFile}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify([...this.shares.values()]), { mode: 0o600 });
      await fs.rename(temp, this.metadataFile);
    });
    return this.writeQueue;
  }
}

export class ShareStoreError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
  }
}
