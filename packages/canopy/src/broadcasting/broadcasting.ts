export interface BroadcastMessage<TPayload = Readonly<Record<string, unknown>>> {
  readonly channel: string;
  readonly event: string;
  readonly payload: TPayload;
}

export interface Broadcaster {
  broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void>;
}
