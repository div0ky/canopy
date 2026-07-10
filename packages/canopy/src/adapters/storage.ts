import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PutFileOptions, Storage, StorageDisk, StoredFile } from '../storage/storage.js';

export class DiskStorage implements Storage {
  public constructor(
    private readonly disks: Readonly<Record<string, StorageDisk>>,
    private readonly defaultDisk = 'local',
  ) {}

  public disk(name = this.defaultDisk): StorageDisk {
    const disk = this.disks[name];
    if (!disk) throw new Error(`Storage disk ${name} is not configured`);
    return disk;
  }
}

export class LocalStorageDisk implements StorageDisk {
  readonly #root: string;

  public constructor(
    root: string,
    private readonly name = 'local',
  ) {
    this.#root = resolve(root);
  }

  public async put(
    path: string,
    contents: Uint8Array,
    options?: PutFileOptions,
  ): Promise<StoredFile> {
    const fullPath = this.resolvePath(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents);
    return {
      disk: this.name,
      path,
      size: contents.byteLength,
      etag: createHash('sha256').update(contents).digest('hex'),
      ...(options?.contentType ? { contentType: options.contentType } : {}),
    };
  }

  public get(path: string): Promise<Uint8Array> {
    return readFile(this.resolvePath(path));
  }

  public async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  public async delete(path: string): Promise<void> {
    await rm(this.resolvePath(path), { force: true });
  }

  public async temporaryUrl(path: string, expiresInMs: number): Promise<string> {
    if (!(await this.exists(path))) throw new Error(`File ${path} does not exist`);
    return `file://${this.resolvePath(path)}?expires=${Date.now() + expiresInMs}`;
  }

  private resolvePath(path: string): string {
    const fullPath = resolve(this.#root, path);
    if (fullPath !== this.#root && !fullPath.startsWith(`${this.#root}${sep}`)) {
      throw new Error('Storage path escapes the configured root');
    }
    return fullPath;
  }
}

export class S3StorageDisk implements StorageDisk {
  public constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly name = 's3',
  ) {}

  public async put(
    path: string,
    contents: Uint8Array,
    options?: PutFileOptions,
  ): Promise<StoredFile> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: contents,
        ...(options?.contentType ? { ContentType: options.contentType } : {}),
        ...(options?.metadata ? { Metadata: { ...options.metadata } } : {}),
      }),
    );
    return {
      disk: this.name,
      path,
      size: contents.byteLength,
      ...(options?.contentType ? { contentType: options.contentType } : {}),
      ...(result.ETag ? { etag: result.ETag } : {}),
    };
  }

  public async get(path: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: path }),
    );
    if (!response.Body) throw new Error(`File ${path} has no body`);
    return response.Body.transformToByteArray();
  }

  public async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: path }));
      return true;
    } catch {
      return false;
    }
  }

  public async delete(path: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: path }));
  }

  public temporaryUrl(path: string, expiresInMs: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: path }), {
      expiresIn: Math.max(1, Math.ceil(expiresInMs / 1_000)),
    });
  }
}
