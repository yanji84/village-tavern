import { describe, it, expect } from 'vitest';
import { initState, buildScene, processAction, onJoin, onLeave } from '../adapter.js';

describe('initState', () => {
  it('returns world-specific state only', () => {
    const state = initState();
    expect(state).toEqual({ log: [] });
  });
});

describe('buildScene', () => {
  it('renders alone scene', () => {
    const state = initState();
    const scene = buildScene(
      { name: 'alice', displayName: 'Alice' },
      [{ name: 'alice', displayName: 'Alice' }],
      state,
    );
    expect(scene).toContain('The Rusty Flagon');
    expect(scene).toContain('tavern is empty');
    expect(scene).toContain('barkeep polishes');
  });

  it('renders scene with others and log', () => {
    const state = {
      log: [{ action: 'say', displayName: 'Bob', message: 'hello!' }],
    };
    const allBots = [
      { name: 'alice', displayName: 'Alice' },
      { name: 'bob', displayName: 'Bob' },
    ];
    const scene = buildScene(allBots[0], allBots, state);
    expect(scene).toContain('**At the tables:** Bob');
    expect(scene).toContain('**Bob:** hello!');
  });
});

describe('processAction', () => {
  const bot = { name: 'alice', displayName: 'Alice' };
  const state = {
    _bots: [
      { name: 'alice', displayName: 'Alice' },
      { name: 'bob', displayName: 'Bob' },
    ],
    log: [],
  };

  it('processes say', () => {
    const result = processAction(bot, { tool: 'tavern_say', params: { message: 'hi' } }, state);
    expect(result).toEqual({ action: 'say', message: 'hi' });
  });

  it('processes toast', () => {
    const result = processAction(bot, { tool: 'tavern_toast', params: { message: 'cheers' } }, state);
    expect(result).toEqual({ action: 'toast', message: 'cheers' });
  });

  it('processes arm_wrestle with existing target', () => {
    const result = processAction(bot, { tool: 'tavern_arm_wrestle', params: { target: 'bob' } }, state);
    expect(result.action).toBe('arm_wrestle');
    expect(result.target).toBe('bob');
    expect(result.message).toContain('Alice');
    expect(result.message).toContain('Bob');
  });

  it('handles arm_wrestle with missing target', () => {
    const result = processAction(bot, { tool: 'tavern_arm_wrestle', params: { target: 'nobody' } }, state);
    expect(result.action).toBe('say');
    expect(result.message).toContain("don't seem to be here");
  });

  it('returns null for unknown action', () => {
    const result = processAction(bot, { tool: 'unknown', params: {} }, state);
    expect(result).toBeNull();
  });
});

describe('onJoin', () => {
  it('appends join entry to log', () => {
    const state = initState();
    onJoin(state, 'alice', 'Alice');
    expect(state.log).toHaveLength(1);
    expect(state.log[0].action).toBe('join');
    expect(state.log[0].message).toContain('pushes open');
  });
});

describe('onLeave', () => {
  it('appends leave entry to log', () => {
    const state = initState();
    onLeave(state, 'alice', 'Alice');
    expect(state.log).toHaveLength(1);
    expect(state.log[0].action).toBe('leave');
    expect(state.log[0].message).toContain('finishes their drink');
  });
});
