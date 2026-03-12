import { describe, it, expect, vi } from 'vitest';
import {
  initState, loadState, advanceClock, joinBot, removeBot,
  recoverParticipants, buildSSEInitPayload, isEventForWorld,
  memoryFilename, hasFastTick,
} from '../adapter.js';
import { loadWorld } from 'openclaw-village-hub/world-loader';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const worldConfig = loadWorld(join(__dirname, '../schema.json'));

describe('tavern adapter metadata', () => {
  it('exports correct memoryFilename', () => {
    expect(memoryFilename).toBe('tavern.md');
  });

  it('has no fast tick', () => {
    expect(hasFastTick).toBe(false);
  });
});

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
    const raw = {
      log: [{ action: 'say', message: 'hello' }],
      clock: { tick: 5 },
      bots: ['alice'],
      villageCosts: { alice: 0.1 },
      remoteParticipants: { alice: { displayName: 'Alice' } },
    };
    const state = loadState(raw, worldConfig);
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

describe('advanceClock', () => {
  it('increments tick', () => {
    const state = { clock: { tick: 3 } };
    advanceClock(state);
    expect(state.clock.tick).toBe(4);
  });
});

describe('joinBot', () => {
  it('adds bot to state and returns join event', async () => {
    const state = initState(worldConfig);
    const { events } = await joinBot(state, 'bob', 'Bob', worldConfig);
    expect(state.bots).toContain('bob');
    expect(state.log).toHaveLength(1);
    expect(state.log[0].action).toBe('join');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tavern_join');
  });

  it('does not duplicate on re-join', async () => {
    const state = initState(worldConfig);
    await joinBot(state, 'bob', 'Bob', worldConfig);
    await joinBot(state, 'bob', 'Bob', worldConfig);
    expect(state.bots.filter(b => b === 'bob')).toHaveLength(1);
  });
});

describe('removeBot', () => {
  it('removes bot and broadcasts leave event', async () => {
    const state = initState(worldConfig);
    await joinBot(state, 'bob', 'Bob', worldConfig);
    const broadcast = vi.fn();
    removeBot(state, 'bob', 'Bob', broadcast);
    expect(state.bots).not.toContain('bob');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'tavern_leave' }));
  });

  it('no-ops for unknown bot', () => {
    const state = initState(worldConfig);
    const broadcast = vi.fn();
    removeBot(state, 'unknown', 'Unknown', broadcast);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('recoverParticipants', () => {
  it('rebuilds participants from state', async () => {
    const state = {
      bots: ['alice', 'bob'],
      remoteParticipants: {
        alice: { displayName: 'Alice' },
        bob: { displayName: 'Bob' },
      },
    };
    const participants = new Map();
    const toRemove = await recoverParticipants(state, participants);
    expect(toRemove).toEqual([]);
    expect(participants.size).toBe(2);
    expect(participants.get('alice').displayName).toBe('Alice');
  });

  it('marks bots without remoteParticipants entry for removal', async () => {
    const state = {
      bots: ['alice', 'orphan'],
      remoteParticipants: { alice: { displayName: 'Alice' } },
    };
    const participants = new Map();
    const toRemove = await recoverParticipants(state, participants);
    expect(toRemove).toEqual(['orphan']);
    expect(participants.size).toBe(1);
  });
});

describe('buildSSEInitPayload', () => {
  it('returns correct init payload', async () => {
    const state = initState(worldConfig);
    await joinBot(state, 'alice', 'Alice', worldConfig);
    const participants = new Map([['alice', { displayName: 'Alice' }]]);
    const payload = buildSSEInitPayload(state, participants, worldConfig, {
      nextTickAt: 1000, tickIntervalMs: 120000,
    });
    expect(payload.type).toBe('init');
    expect(payload.worldType).toBe('social');
    expect(payload.world.id).toBe('tavern');
    expect(payload.bots).toHaveLength(1);
    expect(payload.bots[0].displayName).toBe('Alice');
  });
});

describe('isEventForWorld', () => {
  it('matches tavern events', () => {
    expect(isEventForWorld({ type: 'tavern_say' })).toBe(true);
    expect(isEventForWorld({ type: 'tavern_join' })).toBe(true);
    expect(isEventForWorld({ type: 'tavern_arm_wrestle' })).toBe(true);
    expect(isEventForWorld({ type: 'tick_start' })).toBe(true);
  });

  it('rejects non-tavern events', () => {
    expect(isEventForWorld({ type: 'campfire_say' })).toBe(false);
    expect(isEventForWorld({ type: 'unknown' })).toBe(false);
  });
});
