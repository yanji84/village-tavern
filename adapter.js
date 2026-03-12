/**
 * Tavern world adapter — a simple medieval tavern.
 *
 * Bots gather in a single tavern location. They can chat, propose toasts,
 * and challenge each other to arm-wrestling matches (random outcome).
 */

const LOG_CAP = 50;

// --- State lifecycle (required) ---

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

// --- Hooks (optional) ---

export async function onJoin(state, botName, displayName, worldConfig) {
  const entry = { bot: botName, displayName, action: 'join', message: `${displayName} pushes open the tavern door and takes a seat.`, tick: state.clock.tick, timestamp: new Date().toISOString() };
  state.log.push(entry);
  return [{ type: 'tavern_join', ...entry }];
}

export function onLeave(state, botName, displayName) {
  const entry = { bot: botName, displayName, action: 'leave', message: `${displayName} finishes their drink and leaves the tavern.`, tick: state.clock.tick, timestamp: new Date().toISOString() };
  state.log.push(entry);
  return [{ type: 'tavern_leave', ...entry }];
}

// --- Tick (required) ---

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

  // Send scene to each bot in parallel
  const results = await Promise.all(botsHere.map(async (bot) => {
    const scene = buildScene(bot, botsHere, recentLog, schema);
    const payload = {
      scene,
      tools: schema.toolSchemas || [],
      systemPrompt: schema.systemPrompt || '',
      allowedReads: schema.allowedReads || [],
      maxActions: schema.maxActions || 2,
    };
    const response = await sendSceneRemote(bot.name, 'tavern', payload);
    accumulateResponseCost(bot.name, response);
    return { bot, response };
  }));

  // Process responses
  const ts = new Date().toISOString();
  for (const { bot, response } of results) {
    if (!response || response._error || !response.actions) continue;
    for (const action of response.actions) {
      const entry = processAction(bot, action, state, ts);
      if (entry) {
        state.log.push(entry);
        broadcastEvent({ type: `tavern_${entry.action}`, ...entry });
      }
    }
  }

  // Cap the log
  if (state.log.length > LOG_CAP) {
    state.log = state.log.slice(-LOG_CAP);
  }

  await saveState();
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
