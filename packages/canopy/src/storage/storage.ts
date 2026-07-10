export interface StoredFile {
  readonly disk: string;
  readonly path: string;
  readonly size: number;
  readonly contentType?: string;
  readonly etag?: string;
}

export interface PutFileOptions {
  readonly contentType?: string;
  readonly visibility?: 'private' | 'public';
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface StorageDisk {
  put(path: string, contents: Uint8Array, options?: PutFileOptions): Promise<StoredFile>;
  get(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  temporaryUrl(path: string, expiresInMs: number): Promise<string>;
}

export interface Storage {
  disk(name?: string): StorageDisk;
}
