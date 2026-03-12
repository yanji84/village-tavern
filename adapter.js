/**
 * Tavern world adapter — a simple medieval tavern.
 *
 * Bots gather in a single tavern location. They can chat, propose toasts,
 * and challenge each other to arm-wrestling matches (random outcome).
 */

// --- State (required) ---

export function initState() {
  return { log: [] };
}

// --- Scene (required) ---

export function buildScene(bot, allBots, state) {
  const others = allBots.filter(b => b.name !== bot.name);
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
  const recent = state.log.slice(-10);
  if (recent.length === 0) {
    lines.push("It's quiet. The barkeep polishes a mug and waits.");
  } else {
    for (const entry of recent) {
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

  return lines.join('\n');
}

// --- Tools (required) — one handler per toolSchema entry ---

export const tools = {
  tavern_say(bot, params, state) {
    return { action: 'say', message: params.message };
  },

  tavern_toast(bot, params, state) {
    return { action: 'toast', message: params.message };
  },

  tavern_arm_wrestle(bot, params, state) {
    const targetBot = state._bots.find(b => b.name === params.target);
    if (!targetBot) {
      return { action: 'say', message: `*looks around for ${params.target}* ...they don't seem to be here.` };
    }
    const win = Math.random() > 0.5;
    const message = win
      ? `**${bot.displayName}** challenges **${targetBot.displayName}** to arm-wrestle — and wins! The table shakes as ${bot.displayName} slams ${targetBot.displayName}'s hand down.`
      : `**${bot.displayName}** challenges **${targetBot.displayName}** to arm-wrestle — and loses! ${targetBot.displayName} grins and flexes.`;
    return { action: 'arm_wrestle', message, target: params.target };
  },
};

// --- Hooks (optional) ---

export function onJoin(state, botName, displayName) {
  state.log.push({
    action: 'join',
    bot: botName,
    displayName,
    message: `${displayName} pushes open the tavern door and takes a seat.`,
  });
}

export function onLeave(state, botName, displayName) {
  state.log.push({
    action: 'leave',
    bot: botName,
    displayName,
    message: `${displayName} finishes their drink and leaves the tavern.`,
  });
}
