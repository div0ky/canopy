import Ably from 'ably';
import type { Server } from 'socket.io';
import type { Redis } from 'ioredis';
import type { BroadcastMessage, Broadcaster } from '../broadcasting/broadcasting.js';

export class SocketIoBroadcaster implements Broadcaster {
  public constructor(private readonly server: Server) {}

  public async broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void> {
    this.server.to(message.channel).emit(message.event, message.payload);
  }
}

export class AblyBroadcaster implements Broadcaster {
  readonly #client: Ably.Rest;

  public constructor(apiKey: string) {
    this.#client = new Ably.Rest({ key: apiKey });
  }

  public async broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void> {
    await this.#client.channels.get(message.channel).publish(message.event, message.payload);
  }
}

export class CompositeBroadcaster implements Broadcaster {
  public constructor(private readonly broadcasters: readonly Broadcaster[]) {}

  public async broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void> {
    await Promise.all(this.broadcasters.map((broadcaster) => broadcaster.broadcast(message)));
  }
}

export class RedisBroadcaster implements Broadcaster {
  public constructor(
    private readonly redis: Redis,
    private readonly prefix = 'canopy:broadcast:',
  ) {}

  public async broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void> {
    await this.redis.publish(
      `${this.prefix}${message.channel}`,
      JSON.stringify({ event: message.event, payload: message.payload }),
    );
  }
}

export class RedisBroadcastSubscriber {
  readonly #pattern: string;
  readonly #listener: (pattern: string, channel: string, payload: string) => void;

  public constructor(
    private readonly redis: Redis,
    private readonly downstream: Broadcaster,
    prefix = 'canopy:broadcast:',
  ) {
    this.#pattern = `${prefix}*`;
    this.#listener = (_pattern, channel, payload) => {
      const parsed = JSON.parse(payload) as { event: string; payload: unknown };
      void this.downstream.broadcast({
        channel: channel.slice(prefix.length),
        event: parsed.event,
        payload: parsed.payload,
      });
    };
  }

  public async start(): Promise<void> {
    this.redis.on('pmessage', this.#listener);
    await this.redis.psubscribe(this.#pattern);
  }

  public async close(): Promise<void> {
    this.redis.off('pmessage', this.#listener);
    await this.redis.punsubscribe(this.#pattern);
    await this.redis.quit();
  }
}
