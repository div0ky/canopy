export interface Identity {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface CurrentIdentityResponse {
  readonly identity: Identity;
  readonly authentication: {
    readonly method?: string;
    readonly assurance?: string;
    readonly sessionId?: string;
    readonly credentialId?: string;
    readonly constraints?: readonly string[];
  };
}

export interface AccessToken {
  readonly id: string;
  readonly name: string;
  readonly displayPrefix: string;
  readonly constraints: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export class CanopyClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "CanopyClientError";
  }
}

export async function canopyRequest<Output>(path: string, init?: RequestInit): Promise<Output> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/canopy${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined;
    throw new CanopyClientError(
      response.status,
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? `Canopy returned HTTP ${response.status}.`,
    );
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as Output;
  return await response.json() as Output;
}
