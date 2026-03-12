import { describe, it, expect, vi } from 'vitest';
import {
  initState, loadState, onJoin, onLeave, tick,
} from '../adapter.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(__dirname, '../schema.json'), 'utf-8'));
const worldConfig = { raw };

describe('initState', () => {
  it('returns valid initial state with required fields', () => {
    const state = initState(worldConfig);
    expect(state.log).toEqual([]);
    expect(state.clock).toEqual({ tick: 0 });
    expect(state.bots).toEqual([]);
    expect(state.villageCosts).toEqual({});
    expect(state.remoteParticipants).toEqual({});
  });
});

describe('loadState', () => {
  it('loads saved state', () => {
    const saved = {
      log: [{ action: 'say', message: 'hello' }],
      clock: { tick: 5 },
      bots: ['alice'],
      villageCosts: { alice: 0.1 },
      remoteParticipants: { alice: { displayName: 'Alice' } },
    };
    const state = loadState(saved, worldConfig);
    expect(state.log).toHaveLength(1);
    expect(state.clock.tick).toBe(5);
    expect(state.bots).toEqual(['alice']);
  });

  it('handles missing fields with defaults', () => {
    const state = loadState({}, worldConfig);
    expect(state.log).toEqual([]);
    expect(state.clock).toEqual({ tick: 0 });
    expect(state.bots).toEqual([]);
  });
});

describe('onJoin', () => {
  it('appends to log and returns join event', async () => {
    const state = initState(worldConfig);
    state.bots.push('bob');
    const events = await onJoin(state, 'bob', 'Bob', worldConfig);
    expect(state.log).toHaveLength(1);
    expect(state.log[0].action).toBe('join');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tavern_join');
  });
});

describe('onLeave', () => {
  it('appends to log and returns leave event', () => {
    const state = initState(worldConfig);
    const events = onLeave(state, 'bob', 'Bob');
    expect(state.log).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tavern_leave');
  });
});

describe('tick', () => {
  it('skips when no participants', async () => {
    const state = initState(worldConfig);
    const saveState = vi.fn();
    await tick({
      state, worldConfig,
      participants: new Map(),
      sendSceneRemote: vi.fn(),
      accumulateResponseCost: vi.fn(),
      broadcastEvent: vi.fn(),
      saveState,
    });
    expect(saveState).toHaveBeenCalled();
  });

  it('sends scene and processes actions', async () => {
    const state = initState(worldConfig);
    state.bots.push('alice');
    state.remoteParticipants.alice = { displayName: 'Alice' };

    const broadcastEvent = vi.fn();
    const sendSceneRemote = vi.fn().mockResolvedValue({
      actions: [{ tool: 'tavern_say', params: { message: 'hello!' } }],
    });

    await tick({
      state, worldConfig,
      participants: new Map([['alice', { displayName: 'Alice' }]]),
      sendSceneRemote,
      accumulateResponseCost: vi.fn(),
      broadcastEvent,
      saveState: vi.fn(),
    });

    expect(sendSceneRemote).toHaveBeenCalledWith('alice', 'tavern', expect.objectContaining({ scene: expect.any(String) }));
    expect(state.log).toHaveLength(1);
    expect(state.log[0].action).toBe('say');
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'tavern_say' }));
  });
});
