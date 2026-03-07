import { eventBus } from './EventBus';
import type { PerceptionSnapshot } from '../types/index';

// Test: subscriber fires when event is emitted (no direct import between caller and handler)
function testPubSub(): void {
  const received: PerceptionSnapshot[] = [];

  eventBus.on('perception:updated', (snapshot) => {
    received.push(snapshot);
  });

  const stub: PerceptionSnapshot = {
    timestamp: Date.now(),
    position: { x: 0, y: 64, z: 0 },
    yaw: 0,
    health: 20,
    food: 20,
    gameMode: 'survival',
    isOnGround: true,
    inventory: {},
    equippedItem: null,
    emptySlots: 36,
    biome: 'plains',
    timeOfDay: 6000,
    weather: 'clear',
    nearbyEntities: [],
    nearbyBlocks: [],
    lightLevel: 15,
    currentAction: null,
    recentFailures: [],
  };

  eventBus.emit('perception:updated', stub);

  if (received.length !== 1) {
    throw new Error(`Expected 1 event, got ${received.length}`);
  }
  const first = received[0];
  if (!first || first.position.x !== 0) {
    throw new Error('Payload mismatch');
  }

  // Cleanup
  eventBus.removeAllListeners('perception:updated');
  console.log('EventBus pub/sub: PASS');
}

testPubSub();
export {};
