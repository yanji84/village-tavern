/**
 * Tavern world adapter — a simple medieval tavern.
 *
 * Bots gather in a single tavern location. They can chat, propose toasts,
 * and challenge each other to arm-wrestling matches (random outcome).
 */

const LOG_CAP = 50;

/** Metadata consumed by server.js */
export const memoryFilename = 'tavern.md';
export const hasFastTick = false;

// --- State lifecycle ---

export function initState(worldConfig) {
  return {
    log: [],
    clock: { tick: 0 },
    bots: [],
    villageCosts: {},
    remoteParticipants: {},
  };
}

export function loadState(raw, worldConfig) {
  return {
    log: raw.log || [],
    clock: raw.clock || { tick: 0 },
    bots: raw.bots || [],
    villageCosts: raw.villageCosts || {},
    remoteParticipants: raw.remoteParticipants || {},
  };
}

export function advanceClock(state) {
  state.clock.tick++;
}

// --- Participant management ---

export async function recoverParticipants(state, participants) {
  const toRemove = [];
  for (const botName of state.bots) {
    const entry = state.remoteParticipants[botName];
    if (!entry) { toRemove.push(botName); continue; }
    participants.set(botName, { displayName: entry.displayName || botName });
  }
  return toRemove;
}

export async function joinBot(state, botName, displayName, worldConfig) {
  const events = [];
  if (!state.bots.includes(botName)) {
    state.bots.push(botName);
    const entry = { bot: botName, displayName, action: 'join', message: `${displayName} pushes open the tavern door and takes a seat.`, tick: state.clock.tick, timestamp: new Date().toISOString() };
    state.log.push(entry);
    events.push({ type: 'tavern_join', ...entry });
  }
  return { events, appearance: null };
}

export function removeBot(state, botName, displayName, broadcastEvent) {
  const idx = state.bots.indexOf(botName);
  if (idx !== -1) {
    state.bots.splice(idx, 1);
    const entry = { bot: botName, displayName, action: 'leave', message: `${displayName} finishes their drink and leaves the tavern.`, tick: state.clock.tick, timestamp: new Date().toISOString() };
    state.log.push(entry);
    broadcastEvent({ type: 'tavern_leave', ...entry });
  }
}

// --- Tick loop ---

export async function tick(ctx) {
  const { state, worldConfig, participants, sendSceneRemote,
    accumulateResponseCost, broadcastEvent, saveState,
    SCENE_HISTORY_CAP } = ctx;

  if (participants.size === 0) {
    await saveState();
    return;
  }

  const botsHere = [...participants.entries()].map(([name, p]) => ({
    name, displayName: p.displayName,
  }));

  const recentLog = state.log.slice(-(SCENE_HISTORY_CAP || 10));
  const schema = worldConfig.raw;

  // Send scene to each bot in parallel, tracking per-bot delivery for dev console
  const botDetails = [];
  const results = await Promise.all(botsHere.map(async (bot) => {
    const scene = buildScene(bot, botsHere, recentLog, schema);
    const tools = schema.toolSchemas || [];
    const payload = {
      scene,
      tools,
      systemPrompt: schema.systemPrompt || '',
      allowedReads: schema.allowedReads || [],
      maxActions: schema.maxActions || 2,
    };
    const payloadJson = JSON.stringify(payload);
    const detail = {
      name: bot.name,
      displayName: bot.displayName,
      payloadSize: payloadJson.length,
      toolCount: tools.length,
      payload,
      deliveryMs: 0,
      deliveryStatus: 'ok',
      actions: [],
      error: null,
    };
    const t0 = Date.now();
    const response = await sendSceneRemote(bot.name, 'tavern', payload);
    detail.deliveryMs = Date.now() - t0;
    if (response?.usage) detail.usage = response.usage;
    if (!response || response._error || !response.actions) {
      if (response?._error) {
        detail.deliveryStatus = response._error.type || 'error';
        detail.error = response._error;
      } else {
        detail.deliveryStatus = detail.deliveryMs >= 55000 ? 'timeout' : 'error';
        detail.error = { type: detail.deliveryStatus, message: detail.deliveryStatus };
      }
    }
    accumulateResponseCost(bot.name, response);
    botDetails.push(detail);
    return { bot, response, detail };
  }));

  // Process responses
  const ts = new Date().toISOString();
  for (const { bot, response, detail } of results) {
    if (response._error) continue;
    detail.rawActions = response.actions;
    const processedActions = [];
    for (const action of (response.actions || [])) {
      const entry = processAction(bot, action, state, ts);
      if (entry) {
        state.log.push(entry);
        broadcastEvent({ type: `tavern_${entry.action}`, ...entry });
        processedActions.push({ tool: entry.action, ...(entry.message ? { message: entry.message } : {}), ...(entry.target ? { target: entry.target } : {}) });
      }
    }
    detail.actions = processedActions;
  }

  // Broadcast tick_detail for dev console
  broadcastEvent({
    type: 'tick_detail',
    tick: state.clock.tick,
    timestamp: ts,
    bots: botDetails,
  });

  // Cap the log
  if (state.log.length > LOG_CAP) {
    state.log = state.log.slice(-LOG_CAP);
  }

  await saveState();
}

export const fastTick = null;

// --- Observer ---

export function buildSSEInitPayload(state, participants, worldConfig, { nextTickAt, tickIntervalMs }) {
  const schema = worldConfig.raw;
  return {
    type: 'init',
    worldType: 'social',
    tick: state.clock.tick,
    nextTickAt,
    tickIntervalMs,
    world: {
      id: schema.id,
      name: schema.name,
      description: schema.description,
      version: schema.version,
    },
    bots: state.bots.map(name => ({
      name,
      displayName: participants.get(name)?.displayName || name,
    })),
    log: state.log.slice(-30),
  };
}

export function isEventForWorld(event) {
  if (event.type?.startsWith('tavern_')) return true;
  if (event.type === 'tick_start' || event.type === 'tick_detail') return true;
  return false;
}

// --- Internal helpers ---

function buildScene(bot, botsHere, recentLog, schema) {
  const others = botsHere.filter(b => b.name !== bot.name);
  const lines = [];

  lines.push('## Location: The Rusty Flagon');
  lines.push('');

  if (others.length === 0) {
    lines.push('The tavern is empty. You sit alone with your drink.');
  } else {
    lines.push(`**At the tables:** ${others.map(b => b.displayName).join(', ')}`);
  }
  lines.push('');

  lines.push('### Recent happenings');
  if (recentLog.length === 0) {
    lines.push("It's quiet. The barkeep polishes a mug and waits.");
  } else {
    for (const entry of recentLog) {
      if (entry.action === 'say') {
        lines.push(`- **${entry.displayName}:** ${entry.message}`);
      } else if (entry.action === 'toast') {
        lines.push(`- **${entry.displayName}** raises a mug: "${entry.message}"`);
      } else if (entry.action === 'arm_wrestle') {
        lines.push(`- ${entry.message}`);
      } else if (entry.action === 'join' || entry.action === 'leave') {
        lines.push(`- *${entry.message}*`);
      }
    }
  }
  lines.push('');

  lines.push('### Available actions');
  for (const tool of (schema.toolSchemas || [])) {
    lines.push(`- **${tool.name}**: ${tool.description}`);
  }
  lines.push('');
  lines.push('What do you do?');

  return lines.join('\n');
}

function processAction(bot, action, state, timestamp) {
  const tick = state.clock.tick;

  if (action.tool === 'tavern_say' && action.params?.message) {
    return {
      bot: bot.name, displayName: bot.displayName,
      action: 'say', message: action.params.message,
      tick, timestamp,
    };
  }

  if (action.tool === 'tavern_toast' && action.params?.message) {
    return {
      bot: bot.name, displayName: bot.displayName,
      action: 'toast', message: action.params.message,
      tick, timestamp,
    };
  }

  if (action.tool === 'tavern_arm_wrestle' && action.params?.target) {
    const target = action.params.target;
    const targetExists = state.bots.includes(target);
    if (!targetExists) {
      return {
        bot: bot.name, displayName: bot.displayName,
        action: 'say', message: `*looks around for ${target}* ...they don't seem to be here.`,
        tick, timestamp,
      };
    }
    const win = Math.random() > 0.5;
    const targetDisplay = state.remoteParticipants[target]?.displayName || target;
    const message = win
      ? `**${bot.displayName}** challenges **${targetDisplay}** to arm-wrestle — and wins! The table shakes as ${bot.displayName} slams ${targetDisplay}'s hand down.`
      : `**${bot.displayName}** challenges **${targetDisplay}** to arm-wrestle — and loses! ${targetDisplay} grins and flexes.`;
    return {
      bot: bot.name, displayName: bot.displayName,
      action: 'arm_wrestle', message, target,
      tick, timestamp,
    };
  }

  return null;
}
