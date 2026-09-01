import { EventEmitter } from 'node:events';
import type { WebhookEvent } from '../store/db.js';

/** In-process fan-out so the SSE endpoint can push events to a demo UI live. */
class EventBus extends EventEmitter {
  publish(event: WebhookEvent): void {
    this.emit('webhook', event);
  }

  subscribe(listener: (event: WebhookEvent) => void): () => void {
    this.on('webhook', listener);
    return () => this.off('webhook', listener);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
