// plugins/group_manager/index.js
// Group Manager Plugin - Entry point and admin commands

import { filterDB, whitelistDB, warningsDB, configDB } from './database.js';
import { filterProcessor } from './processor.js';
import { extractNumericId, jidMatch } from '../../../utils/jidHelper.js';
import { tryParseJson } from '../../../utils/ResponseFormatEnforcer.js';

interface GroupManagerMessage {
  isGroup: boolean;
  mentionedJids?: string[];
  botJid?: string;
  sender: string;
  raw?: unknown;
  quoted?: { sender: string };
}

interface GroupManagerTransport {
  sock: {
    user?: { id: string; lid?: string };
    groupInviteCode(chatId: string): Promise<string>;
    groupParticipantsUpdate(
      chatId: string,
      participants: string[],
      action: 'promote' | 'demote' | 'add' | 'remove',
    ): Promise<void>;
    groupMetadata(chatId: string): Promise<{
      participants: Array<{ id: string; admin: string | null }>;
      subject: string;
      desc?: string;
      creation?: number;
    }>;
    sendMessage(
      chatId: string,
      content: {
        delete: {
          id?: string | null;
          remoteJid?: string | null;
          fromMe?: boolean | null;
          participant?: string | null;
        };
      },
    ): Promise<unknown>;
  };
  container: {
    get(name: string): {
      banUser(chatId: string, targetJid: string, reason: string, transport: unknown): Promise<void>;
    };
  };
  isAdmin(chatId: string, sender: string): Promise<boolean>;
  tagAll(chatId: string, reason?: string): Promise<void>;
  banUser(chatId: string, userJid: string, reason?: string): Promise<void>;
  kickUser(chatId: string, userJid: string, reason?: string): Promise<void>;
  promoteUser(chatId: string, userJid: string): Promise<void>;
  demoteUser(chatId: string, userJid: string): Promise<void>;
  lockGroup(chatId: string, lock: boolean): Promise<void>;
  updateGroupSetting(chatId: string, setting: string): Promise<void>;
  sendText(chatId: string, text: string, options?: { mentions?: string[] }): Promise<unknown>;
}

interface GroupManagerArgs {
  keyword?: string;
  rule?: string;
  severity?: 'warn' | 'kick' | 'ban' | 'mute';
  regex_variants?: string[];
  context_rule?: string;
  filter_id?: string;
  user_jid?: string;
  is_filtering_active?: boolean;
  warning_limit?: number;
  auto_ban?: boolean;
  reason?: string;
  phone_number?: string;
  duration?: number;
  action?: string;
  value?: number;
  title?: string;
  description?: string;
  delay_minutes?: number;
}

export default {
  name: 'group_manager',
  description: 'Advanced group management: filtering, warnings, auto-bans.',
  version: '1.0.0',
  enabled: true,

  // Expose processor for core integration
  processor: filterProcessor,

  // ========================================================================
  // TEXT MATCHERS: Regex patterns for textual fallback (core decoupling)
  // ========================================================================
  textMatchers: [
    {
      // Pattern BAN: [ban:@xxx], ban @xxx, **ban**, etc.
      pattern: /\bban\b/i,
      handler: 'whatsapp_ban_user',
      description: 'Ban a mentioned user',
      extractArgs: (_match: RegExpMatchArray, message: GroupManagerMessage, _text: string) => {
        // We need mentions from the original message
        const mentionedJids = message.mentionedJids || [];
        if (mentionedJids.length === 0) return null;

        // Filter JIDs that are not the bot
        const botId = message.botJid?.split(':')[0]?.split('@')[0];
        const targetJids = mentionedJids.filter((jid: string) => {
          const id = jid.split('@')[0];
          return id !== botId;
        });

        if (targetJids.length === 0) return null;
        return { user_jid: targetJids[0] };
      },
    },
    {
      // Pattern TAGALL: tagall, tag all, [tagall], tag:all
      pattern: /\[?tag[:\s_-]*all\]?/i,
      handler: 'whatsapp_tagall',
      description: 'Tag all group members',
      extractArgs: (_match: RegExpMatchArray, _message: GroupManagerMessage, text: string) => {
        // Extract reason after "tagall"
        const reasonMatch = text.match(/tag[:\s_-]*all[:\s]+(.+)/i);
        return { reason: reasonMatch?.[1]?.trim() || '' };
      },
    },
    {
      // Pattern ADD: [add:123456789]
      pattern: /\[add[:\s]+(\d+)\]/i,
      handler: 'whatsapp_add_user',
      description: 'Add a user by phone number',
      extractArgs: (match: RegExpMatchArray) => {
        return { phone_number: match[1] };
      },
    },
  ],

  // Tool definitions for the AI
  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'whatsapp_filter_add',
        description: 'Adds a forbidden keyword or regex to the group filter. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: 'Forbidden keyword' },
            severity: {
              type: 'string',
              enum: ['warn', 'kick', 'ban', 'mute'],
              description: 'Action to take',
            },
            regex_variants: {
              type: 'array',
              items: { type: 'string' },
              description: 'Regex variants (optional)',
            },
            context_rule: {
              type: 'string',
              description: 'Context rule for LLM analysis (optional)',
            },
          },
          required: ['keyword', 'severity'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_filter_remove',
        description: 'Removes a filter by ID. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            filter_id: { type: 'string', description: 'UUID of the filter to remove' },
          },
          required: ['filter_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_filter_list',
        description: 'Lists all active filters for this group.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_whitelist_add',
        description: 'Whitelists a user to bypass filters. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'JID of the user to whitelist' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_config',
        description: 'Configures group management settings. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            is_filtering_active: { type: 'boolean', description: 'Enable/disable filtering' },
            warning_limit: { type: 'integer', description: 'Max warnings before ban' },
            auto_ban: { type: 'boolean', description: 'Auto-ban when limit reached' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_warnings_reset',
        description: 'Resets warnings for a user. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'User JID' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_tagall',
        description: 'Mentions everyone in the group. BOT ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: { reason: { type: 'string', description: 'Reason for tagging everyone' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_ban_user',
        description: 'Bans a user. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'User JID' },
            reason: { type: 'string', description: 'Reason for the ban' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_add_user',
        description: 'Generates an invitation link to add a member.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_mute_user',
        description: 'Temporarily mutes a user. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'JID of user to mute' },
            duration: { type: 'integer', description: 'Duration in minutes' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_unmute_user',
        description: 'Unmutes a user. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'JID of user to unmute' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_promote',
        description: 'Promotes a member to group admin. BOT ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'JID of member to promote' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_demote',
        description: 'Demotes a group admin. BOT ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'JID of admin to demote' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_kick_user',
        description: 'Kicks a user. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'User JID' },
            reason: { type: 'string', description: 'Reason for kick' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_warn_user',
        description: 'Gives an official warning to a user. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            user_jid: { type: 'string', description: 'User JID' },
            reason: { type: 'string', description: 'Reason for warning' },
          },
          required: ['user_jid'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whatsapp_lock_group',
        description: 'Locks/Unlocks the group. ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['lock', 'unlock'], description: 'Action' },
          },
          required: ['action'],
        },
      },
    },
  ],

  /**
   * Executes a Group Manager command
   */
  async execute(
    args: GroupManagerArgs,
    context: {
      transport: GroupManagerTransport;
      message: GroupManagerMessage;
      chatId: string;
      sender: string;
    },
    toolName: string,
  ) {
    const { transport, message, chatId, sender } = context || {};

    if (!transport || !message || !chatId || !sender) {
      return { success: false, error: 'CONTEXT_ERROR: Missing required context.' };
    }

    if (!message.isGroup) {
      return { success: false, error: 'DENIED: Command reserved for groups.' };
    }

    const isAdmin = await transport.isAdmin(chatId, sender);
    if (!isAdmin && toolName !== 'whatsapp_filter_list') {
      return { success: false, error: 'DENIED: Only admins can use this module.' };
    }

    const adminTools = new Set([
      'whatsapp_ban_user',
      'whatsapp_kick_user',
      'whatsapp_promote',
      'whatsapp_demote',
      'whatsapp_lock_group',
    ]);

    if (adminTools.has(toolName)) {
      return await this._executeAdminCommand(toolName, chatId, args, transport);
    }

    switch (toolName) {
      case 'whatsapp_filter_add':
        return await this._addFilter(chatId, args, sender);

      case 'whatsapp_filter_list':
        return await this._listFilters(chatId);

      case 'whatsapp_filter_remove':
        if (!args.filter_id) {
          return { success: false, message: '❌ Missing filter_id parameter.' };
        }
        return await this._removeFilter(chatId, args.filter_id);

      case 'whatsapp_whitelist_add':
        return await this._addWhitelist(chatId, args, sender, message);

      case 'whatsapp_config':
        return await this._configure(chatId, args);

      case 'whatsapp_warnings_reset':
        return await this._resetWarnings(chatId, args, message);

      case 'whatsapp_tagall':
        await transport.tagAll(chatId, args.reason);
        return { success: true, message: '📢 Everyone has been tagged.' };

      case 'whatsapp_warn_user': {
        await filterProcessor._executeAction(
          transport,
          chatId,
          args.user_jid || '',
          { keyword: 'Manual warn', severity: 'warn', id: 'manual' },
          { shouldAct: true, reason: args.reason || 'Admin manual warning' },
          (await configDB.get(chatId)) || {},
        );
        return { success: true, message: `⚠️ Warning given to ${args.user_jid}.` };
      }

      case 'whatsapp_add_user':
        return await this._generateInvite(chatId, transport);

      case 'whatsapp_mute_user':
        return await this._muteUser(chatId, args, message);

      case 'whatsapp_unmute_user':
        return await this._unmuteUser(chatId, args, message);

      case 'whatsapp_mission':
        return await this._getMission(chatId);

      case 'whatsapp_setmission':
        return await this._setMission(chatId, args, sender, context);

      case 'whatsapp_mygroups':
        return await this._listMyGroups(sender);

      case 'whatsapp_groupstats':
        return await this._getGroupStats(chatId);

      case 'whatsapp_groupinfo':
        return await this._getGroupInfo(chatId, transport);

      default:
        return { success: false, message: `Unknown command: ${toolName}` };
    }
  },

  /**
   * Executes group admin actions
   */
  async _executeAdminCommand(
    toolName: string,
    chatId: string,
    args: GroupManagerArgs,
    transport: GroupManagerTransport,
  ): Promise<{ success: boolean; message: string }> {
    switch (toolName) {
      case 'whatsapp_ban_user':
        await transport.banUser(chatId, args.user_jid || '', args.reason);
        return { success: true, message: `🚫 User ${args.user_jid || ''} has been banned.` };

      case 'whatsapp_kick_user':
        await transport.kickUser(chatId, args.user_jid || '', args.reason);
        return { success: true, message: `👢 User ${args.user_jid || ''} has been kicked.` };

      case 'whatsapp_promote':
        await transport.promoteUser(chatId, args.user_jid || '');
        return {
          success: true,
          message: `⭐ User ${args.user_jid || ''} has been promoted to admin.`,
        };

      case 'whatsapp_demote':
        await transport.demoteUser(chatId, args.user_jid || '');
        return { success: true, message: `👤 User ${args.user_jid || ''} is no longer an admin.` };

      case 'whatsapp_lock_group':
        await transport.lockGroup(chatId, args.action === 'lock');
        return {
          success: true,
          message: `🔒 Group is now ${args.action === 'lock' ? 'locked' : 'unlocked'}.`,
        };

      default:
        throw new Error(`Unhandled admin command: ${toolName}`);
    }
  },

  /**
   * Ajoute un filtre
   */
  async _addFilter(groupJid: string, args: GroupManagerArgs, sender: string) {
    try {
      const filter = await filterDB.addFilter(
        groupJid,
        args.keyword || '',
        args.rule || "Ban si sérieux, tolérer l'humour",
        args.severity || 'warn',
        sender,
      );

      // Générer des variantes automatiquement
      const variants = await filterProcessor.generateVariants(args.keyword || '');
      if (variants.length) {
        await filterDB.updateVariants(filter.id, variants);
      }

      // Invalider le cache
      filterProcessor.invalidateCache(groupJid);

      return {
        success: true,
        message:
          `✅ Filter added: "${args.keyword}" (${args.severity || 'warn'})\n` +
          `Rule: ${args.rule || 'default'}\n` +
          `Variants generated: ${variants.length}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error adding filter: ${err.message}` };
    }
  },

  /**
   * Liste les filtres
   */
  async _listFilters(groupJid: string) {
    try {
      const filters = await filterDB.getFilters(groupJid);
      const config = await configDB.get(groupJid);

      if (!filters.length) {
        return { success: true, message: '📋 No filters configured.' };
      }

      const list = filters
        .map(
          (f: { keyword: string; severity: string; context_rule?: string }, i: number) =>
            `${i + 1}. **${f.keyword}** [${f.severity}]\n   └ ${f.context_rule || 'Default rule'}`,
        )
        .join('\n');

      const status = config?.is_filtering_active ? '🟢 ACTIVE' : '🔴 INACTIVE';

      return {
        success: true,
        message:
          `📋 **Group Filters** ${status}\n\n${list}\n\n` +
          `⚠️ Warning limit: ${config?.warning_limit || 3}\n` +
          `🔨 Auto-ban: ${config?.auto_ban ? 'Yes' : 'No'}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error listing filters: ${err.message}` };
    }
  },

  /**
   * Supprime un filtre
   */
  async _removeFilter(groupJid: string, filterId: string) {
    try {
      await filterDB.removeFilter(filterId);
      filterProcessor.invalidateCache(groupJid);
      return { success: true, message: `✅ Filter #${filterId} removed.` };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error removing filter: ${err.message}` };
    }
  },

  /**
   * Ajoute à la whitelist
   */
  async _addWhitelist(
    groupJid: string,
    args: GroupManagerArgs,
    sender: string,
    message: GroupManagerMessage,
  ) {
    // Utiliser la mention du message original si disponible
    let targetJid = args.user_jid || '';
    const mentions = message.mentionedJids || [];

    if (mentions.length > 0) {
      // Prendre le premier JID mentionné (hors bot)
      targetJid = mentions[0];
    }

    try {
      await whitelistDB.add(groupJid, targetJid, sender);
      // Get username from message or fallback to JID
      const username = this._getUsername(message.raw, targetJid) || targetJid.split('@')[0];
      return { success: true, message: `✅ @${username} added to whitelist.` };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error adding to whitelist: ${err.message}` };
    }
  },

  /**
   * Configure le groupe
   */
  async _configure(groupJid: string, args: GroupManagerArgs) {
    try {
      switch (args.action) {
        case 'enable':
          await configDB.setFilteringActive(groupJid, true);
          return { success: true, message: '🟢 Filtrage activé!' };

        case 'disable':
          await configDB.setFilteringActive(groupJid, false);
          return { success: true, message: '🔴 Filtrage désactivé.' };

        case 'set_warnings': {
          const limit = args.value || 3;
          await configDB.setWarningLimit(groupJid, limit);
          return { success: true, message: `⚠️ Limite de warnings: ${limit}` };
        }

        case 'auto_ban_on':
          await configDB.setAutoBan(groupJid, true);
          return { success: true, message: '🔨 Auto-ban activé.' };

        case 'auto_ban_off':
          await configDB.setAutoBan(groupJid, false);
          return { success: true, message: '🔨 Auto-ban désactivé.' };

        default:
          return { success: false, message: `Action inconnue: ${args.action}` };
      }
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Erreur: ${err.message}` };
    }
  },

  /**
   * Réinitialise les warnings
   */
  async _resetWarnings(groupJid: string, args: GroupManagerArgs, message: GroupManagerMessage) {
    let targetJid = args.user_jid || '';
    const mentions = message.mentionedJids || [];

    if (mentions.length > 0) {
      targetJid = mentions[0];
    }

    try {
      await warningsDB.reset(groupJid, targetJid);
      const username = this._getUsername(message.raw, targetJid) || targetJid.split('@')[0];
      return { success: true, message: `✅ Warnings de @${username} réinitialisés.` };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Erreur: ${err.message}` };
    }
  },

  /**
   * Bannit un utilisateur (Logique intelligente fusionnée)
   */
  async _resolveTargetJid(
    chatId: string,
    targetJidInput: string,
    msgMentions: string[],
    rawBotId: string,
    rawBotLid: string,
  ): Promise<string | null> {
    let targetJid = targetJidInput;

    // Si l'IA n'a pas fourni de user_jid, on cherche dans les mentions
    if (!targetJid && msgMentions.length > 0) {
      // Filtrer pour exclure le bot des mentions via jidMatch
      const nonBotMentions = msgMentions.filter((jid: string) => {
        const isBot = jidMatch(jid, rawBotId) || jidMatch(jid, rawBotLid);
        console.log(`[DEBUG Ban] Checking ${extractNumericId(jid)}: isBot=${isBot}`);
        return !isBot;
      });

      if (nonBotMentions.length > 0) {
        targetJid = nonBotMentions[0];
        console.log('[DEBUG Ban] Target sélectionné depuis mentions:', targetJid);
      }
    }

    // Fallback: si user_jid existe déjà, vérifier qu'il contient le format JID
    if (targetJid && !targetJid.includes('@')) {
      // PHASE SOCIAL GRAPH: Résolution par nom si ce n'est pas un numéro
      const isNumeric = /^\d+$/.test(targetJid.replace(/\D/g, ''));

      if (!isNumeric && targetJid.length >= 2) {
        // C'est probablement un nom, essayer de résoudre via userService
        console.log(`[DEBUG Ban] Tentative de résolution du nom: "${targetJid}"`);
        const { userService } = await import('../../../services/userService.js');
        const resolvedJid = await userService.resolveToJid(targetJid, chatId);

        if (resolvedJid) {
          console.log(`[DEBUG Ban] Nom résolu: "${targetJid}" → ${resolvedJid}`);
          targetJid = resolvedJid;
        } else {
          console.log(`[DEBUG Ban] Impossible de résoudre le nom: "${targetJid}"`);
          return null;
        }
      } else {
        // C'est un numéro, formatter en JID
        targetJid = targetJid.replace(/\D/g, '') + '@s.whatsapp.net';
      }
    }

    return targetJid || null;
  },

  /**
   * Bannit un utilisateur (Logique intelligente fusionnée)
   */
  async _banUser(
    chatId: string,
    args: GroupManagerArgs,
    message: GroupManagerMessage,
    transport: GroupManagerTransport,
  ) {
    // Import du service DB pour vérifier le fondateur
    const { db } = await import('../../../services/supabase.js');

    const msgMentions = message.mentionedJids || [];

    console.log('[DEBUG Ban] Input participant:', args.user_jid);
    console.log('[DEBUG Ban] Participants du groupe:', msgMentions);

    // Récupérer les identifiants du bot via jidHelper
    const rawBotId = transport.sock?.user?.id || '';
    const rawBotLid = transport.sock?.user?.lid || '';

    const targetJid = await this._resolveTargetJid(
      chatId,
      args.user_jid || '',
      msgMentions,
      rawBotId,
      rawBotLid,
    );

    // **PROTECTION ANTI SELF-BAN** via jidMatch
    if (targetJid) {
      const isBotTarget = jidMatch(targetJid, rawBotId) || jidMatch(targetJid, rawBotLid);

      if (isBotTarget) {
        console.log('[DEBUG Ban] ⚠️ Tentative de ban du bot détectée!');

        // Vérifier si l'utilisateur est le fondateur du groupe
        const founder = (await db.getGroupFounder(chatId)) as string | null;
        const isFounder = founder && jidMatch(message.sender, founder);

        if (!isFounder) {
          return {
            success: false,
            message:
              '🛡️ Je ne peux pas me bannir moi-même! Seul le fondateur du groupe peut me retirer.',
          };
        }

        console.log('[DEBUG Ban] ✓ Fondateur autorisé à bannir le bot');
        // Le fondateur peut bannir le bot - on continue
      }
    }

    // Vérifier qu'on a bien un targetJid
    if (!targetJid) {
      return {
        success: false,
        message: "❌ Impossible d'identifier l'utilisateur à bannir. Mentionnez-le explicitement.",
      };
    }

    console.log(`[DEBUG Ban] Tentative de ban avec JID: ${targetJid}`);

    // GESTION DU DÉLAI (Delayed Ban)
    if (args.delay_minutes && args.delay_minutes > 0) {
      const delayMs = args.delay_minutes * 60 * 1000;
      const executionTime = new Date(Date.now() + delayMs);
      const username = this._getUsername(message.raw, targetJid) || targetJid.split('@')[0];

      // Créer un rappel spécial "COMMAND:BAN_USER"
      // Format du message: COMMAND:BAN_USER:{jid}|Raison
      const commandPayload = `COMMAND:BAN_USER:${targetJid}|${args.reason || 'Ban différé'}`;

      try {
        // On utilise db.createReminder (via supabase service)
        const { db: dbInstance } = await import('../../../services/supabase.js');
        await dbInstance.createReminder(chatId, commandPayload, executionTime);

        return {
          success: true,
          message: `⏳ **Ban planifié !**\n\n👤 Utilisateur: @${username}\n⏱️ Délai: ${args.delay_minutes} minute(s)\n📅 Exécution: ${executionTime.toLocaleTimeString()}`,
        };
      } catch (err: unknown) {
        const errorInstance = err as Error;
        return { success: false, message: `Erreur planification ban: ${errorInstance.message}` };
      }
    }

    try {
      const moderation = transport.container.get('moderation');
      await moderation.banUser(chatId, targetJid, args.reason || 'Aucune', transport);
      // Récupérer le nom depuis le message ou fallback sur JID
      const username = this._getUsername(message.raw, targetJid) || targetJid.split('@')[0];
      return {
        success: true,
        message: `🚫 Utilisateur @${username} banni.\nRaison: ${args.reason || 'Aucune'}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[Ban] Erreur:', err);
      return { success: false, message: `Erreur ban: ${err.message}` };
    }
  },

  /**
   * Génère un lien d'invitation (Contournement limitation Add)
   */
  async _generateInvite(chatId: string, transport: GroupManagerTransport) {
    try {
      const code = await transport.sock.groupInviteCode(chatId);
      const link = `https://chat.whatsapp.com/${code}`;
      return {
        success: true,
        message: `🔗 Voici le lien d'invitation pour ajouter le membre :\n${link}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Erreur génération lien: ${err.message}` };
    }
  },

  /**
   * Mute temporairement un utilisateur (le bot ignore ses messages)
   */
  async _muteUser(chatId: string, args: GroupManagerArgs, message: GroupManagerMessage) {
    let targetJid = args.user_jid;
    const mentions = message.mentionedJids || [];

    if (mentions.length > 0) {
      targetJid = mentions[0];
    }

    // PHASE SOCIAL GRAPH: Résolution par nom si nécessaire
    if (targetJid && !targetJid.includes('@')) {
      const isNumeric = /^\d+$/.test(targetJid.replace(/\D/g, ''));

      if (!isNumeric && targetJid.length >= 2) {
        console.log(`[DEBUG Mute] Tentative de résolution du nom: "${targetJid}"`);
        const { userService } = await import('../../../services/userService.js');
        const resolvedJid = await userService.resolveToJid(targetJid, chatId);

        if (resolvedJid) {
          targetJid = resolvedJid;
        } else {
          return {
            success: false,
            message: `❌ Je ne connais pas "${targetJid}" dans ce groupe.`,
          };
        }
      } else {
        targetJid = targetJid.replace(/\D/g, '') + '@s.whatsapp.net';
      }
    }

    if (!targetJid) {
      return {
        success: false,
        message: "❌ Mentionnez l'utilisateur à mute.",
      };
    }

    const duration = args.duration || 30; // 30 minutes par défaut

    try {
      const { workingMemory } = await import('../../../services/workingMemory.js');
      await workingMemory.muteUser(chatId, targetJid, duration);
      const username = this._getUsername(message.raw, targetJid) || targetJid.split('@')[0];
      return {
        success: true,
        message: `🔇 @${username} est mute pour ${duration} minutes.\nJe n'écouterai plus ses messages pendant ce temps.`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Erreur mute: ${err.message}` };
    }
  },

  _parseFilterSubCommand(subCmd: string | undefined, parts: string[]) {
    if (subCmd === 'add') {
      const content = parts.slice(3).join(' ');
      const [keywordPart, rulePart] = content.split('|').map((s: string) => s.trim());
      const keyword = keywordPart.replace(/["']/g, '');
      const rule = rulePart?.replace(/r[eè]gle:?\s*/i, '').replace(/["']/g, '');
      return { name: 'whatsapp_filter_add', args: { keyword, rule } };
    }
    if (subCmd === 'list') return { name: 'whatsapp_filter_list', args: {} };
    return null;
  },

  _parseEnableDisableSubCommand(cmd: string, subCmd: string | undefined) {
    if (cmd !== 'enable' && cmd !== 'disable') return null;
    const isEnable = cmd === 'enable';
    if (subCmd === 'auto_ban') {
      return {
        name: 'whatsapp_config',
        args: { action: isEnable ? 'auto_ban_on' : 'auto_ban_off' },
      };
    }
    if (!subCmd) {
      return { name: 'whatsapp_config', args: { action: isEnable ? 'enable' : 'disable' } };
    }
    return null;
  },

  _parseSubCommand(cmd: string, subCmd: string | undefined, parts: string[]) {
    if (cmd === 'filter') return this._parseFilterSubCommand(subCmd, parts);
    if (cmd === 'config' && subCmd === 'warnings') {
      const value = parseInt(parts[3]);
      return {
        name: 'whatsapp_config',
        args: { action: 'set_warnings', value: isNaN(value) ? 3 : value },
      };
    }
    return this._parseEnableDisableSubCommand(cmd, subCmd);
  },

  /**
   * Parse les commandes textuelles .task
   * Appelé depuis le core pour les commandes directes
   */
  parseTextCommand(text: string) {
    if (!text.toLowerCase().startsWith('.task')) return null;

    const parts = text.trim().split(/\s+/);
    const cmd = parts[1]?.toLowerCase();
    const subCmd = parts[2]?.toLowerCase();

    const subResult = this._parseSubCommand(cmd, subCmd, parts);
    if (subResult) return subResult;

    if (cmd === 'whitelist') return { name: 'whatsapp_whitelist_add', args: {} };

    if (cmd === 'ban') {
      return {
        name: 'whatsapp_ban_user',
        args: {
          user_jid: null,
          reason: parts.slice(3).join(' ') || 'Commande .task',
        },
      };
    }

    if (cmd === 'mute') {
      const possibleDuration = parseInt(parts[parts.length - 1]);
      const hasDuration = !isNaN(possibleDuration) && parts.length > 3;
      return {
        name: 'whatsapp_mute_user',
        args: {
          user_jid: null,
          duration: hasDuration ? possibleDuration : 30,
        },
      };
    }

    if (cmd === 'unmute') return { name: 'whatsapp_unmute_user', args: { user_jid: null } };
    if (cmd === 'tagall')
      return { name: 'whatsapp_tagall', args: { reason: parts.slice(2).join(' ') } };

    return null;
  },

  /**
   * Gets username from a message
   */
  _getUsername(rawMessage: unknown, targetJid: string): string | null {
    // Try to get name from pushName in mentions
    const msg = rawMessage as {
      message?: { extendedTextMessage?: { contextInfo?: { mentionedJid?: string[] } } };
      participant?: string;
      key?: { participant?: string };
      pushName?: string;
    } | null;

    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
    if (contextInfo?.mentionedJid?.includes(targetJid)) {
      // WhatsApp doesn't store names directly in mentionedJid
      // We use pushName if it's the sender
      if (msg?.participant === targetJid || msg?.key?.participant === targetJid) {
        return msg?.pushName || null;
      }
    }
    // Fallback: return null to use JID
    return null;
  },

  // ============================================================
  // groupService INTEGRATION (Phase 2) - New methods
  // ============================================================

  /**
   * Displays the bot mission in this group
   */
  async _getMission(groupJid: string) {
    try {
      const { groupService } = await import('../../../services/groupService.js');
      const missionData = (await groupService.getBotMission(groupJid)) as {
        title?: string;
        description?: string;
        author?: string;
      } | null;

      if (missionData && missionData.description) {
        return {
          success: true,
          message: `🎯 **Bot Mission:**\n\n📌 **${missionData.title || 'Untitled'}**\n📝 ${missionData.description}\n\n👤 *Defined by: @${missionData.author ? missionData.author.split('@')[0] : 'Unknown'}*`,
        };
      } else {
        return {
          success: true,
          message: '📋 No mission defined for this group.',
        };
      }
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error: ${err.message}` };
    }
  },

  /**
   * Sets the bot mission in this group
   */
  async _setMission(
    chatId: string,
    args: GroupManagerArgs,
    sender: string,
    context: {
      transport: GroupManagerTransport;
      message: GroupManagerMessage;
      chatId: string;
      sender: string;
    },
  ) {
    if (!args.description?.trim()) {
      return { success: false, message: '❌ Please specify a description.' };
    }

    try {
      const { groupService } = await import('../../../services/groupService.js');
      // Update via service
      await groupService.setBotMission(chatId, args.title || '', args.description, sender);

      const authorName = sender.split('@')[0];
      let message = `✅ **Mission updated!**\n\n> Title: ${args.title || ''}\n> Author: @${authorName}\n> Description: ${args.description}`;

      // --- ACTIONABLE ANALYSIS ---
      try {
        const analysisResult = await this._analyzeAndExecuteMission(
          chatId,
          args.description,
          context,
        );
        if (analysisResult && analysisResult.length > 0) {
          const actionsText = analysisResult.map((r: string) => `- ${r}`).join('\n');
          message += `\n\n🚀 **Actions triggered:**\n${actionsText}`;
        }
      } catch (anaError: unknown) {
        const err = anaError as Error;
        console.error('[GroupManager] Mission Analysis Error:', err);
      }

      return {
        success: true,
        message,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error setting mission: ${err.message}` };
    }
  },

  async _analyzeAndExecuteMission(
    _chatId: string,
    missionText: string,
    context: {
      transport: GroupManagerTransport;
      message: GroupManagerMessage;
      chatId: string;
      sender: string;
    },
  ) {
    console.log(`[GroupManager] Mission analysis: "${missionText}"`);

    // 1. Ask AI to extract actions
    // We use the provider configured for intelligence (Gemini)

    const systemPrompt = `You are a WhatsApp administration assistant. Your task is to analyze a "Mission" given by an administrator and detect if there are IMMEDIATE actions to execute.
        
        AVAILABLE TOOLS:
        - whatsapp_ban_user(user_jid): Ban a user (Full JID required or @Tag)
        - whatsapp_mute_user(user_jid, duration): Mute a user
        - whatsapp_filter_add(keyword, severity): Add a spam filter
        - whatsapp_groupstats(): View stats
        
        If the mission contains clear orders (e.g.: "Ban @12345", "Add filter 'casino'"), generate a structured JSON.
        If the mission is just descriptive (e.g.: "Welcome people"), return empty JSON.
        
        <output_format>
        Answer ONLY in JSON matching this format:
        {
          "actions": [
            { "tool": "whatsapp_ban_user", "args": { "user_jid": "123456@s.whatsapp.net" } }
          ]
        }
        
        Few-shot examples:
        - {"actions": []}
        - {"actions": [{"tool": "whatsapp_filter_add", "args": {"keyword": "casino", "severity": "warn"}}]}
        </output_format>
        
        IMPORTANT:
        - Convert mentions e.g.: "@123" -> attempt to guess or request raw. The user has context.
        - If you cannot resolve a @Tag, ignore the action.
        `;

    try {
      // providerRouter is dynamically imported to avoid side-effects
      const { providerRouter } = await import('../../../providers/index.js');
      const response = await providerRouter.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Mission: ${missionText}` },
        ],
        {
          temperature: 0, // Zero creativity, pure logic
          jsonMode: true, // Force JSON if supported, otherwise the prompt asks for it
        },
      );

      if (!response.content) {
        throw new Error('Réponse vide reçue du modèle pour la génération de plan');
      }
      const plan = tryParseJson<{ actions?: Array<{ tool: string; args: GroupManagerArgs }> }>(
        response.content,
      );

      const results: string[] = [];

      if (plan?.actions && Array.isArray(plan.actions)) {
        console.log(`[GroupManager] ${plan.actions.length} actions detected`);

        for (const action of plan.actions) {
          // Security: limit to 'whatsapp_' tools
          if (!action.tool.startsWith('whatsapp_')) continue;

          results.push(`Executing: ${action.tool}...`);

          // Execute via local execute method
          // Ensure args are correct
          const res = (await this.execute(action.args, context, action.tool)) as {
            success: boolean;
            message?: string;
            error?: string;
          };

          if (res.success) {
            results.push(`✓ ${action.tool}: Success`);
          } else {
            results.push(`✗ ${action.tool}: ${res.message || res.error}`);
          }
        }
      }

      return results;
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[GroupManager] AI Analysis Error:', err);
      return [];
    }
  },

  /**
   * Lists all groups where the user is an admin
   */
  async _listMyGroups(userJid: string) {
    try {
      const { groupService } = await import('../../../services/groupService.js');
      const groups = await groupService.getAdminGroups(userJid);

      if (!groups || groups.length === 0) {
        return {
          success: true,
          message: '📋 You are not an admin in any group (according to my data).',
        };
      }

      // Get group names from Supabase
      const { supabase } = await import('../../../services/supabase.js');
      if (!supabase) return { success: false, message: 'Database not available' };
      const { data: groupData } = await supabase
        .from('groups')
        .select('jid, name')
        .in('jid', groups);

      const groupMap = new Map<string, string>(
        (groupData || []).map((g: { jid: string; name: string }) => [g.jid, g.name]),
      );

      const list = groups
        .map((jid: string, i: number) => {
          const name = groupMap.get(jid) || jid.split('@')[0];
          return `${i + 1}. ${name}`;
        })
        .join('\n');

      return {
        success: true,
        message: `👑 **Groups where you are admin (${groups.length}):**\n\n${list}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error listing groups: ${err.message}` };
    }
  },

  /**
   * Displays group statistics
   */
  async _getGroupStats(groupJid: string) {
    try {
      const { groupService } = await import('../../../services/groupService.js');
      const { supabase } = await import('../../../services/supabase.js');
      if (!supabase) return { success: false, message: 'Database not available' };

      // Count admins
      const adminCount = await groupService.countAdmins(groupJid);

      // Fetch group info
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .select('*')
        .eq('platform_group_id', groupJid)
        .single();

      if (groupError) {
        console.error('[GroupStats] Error fetching group:', groupError.message);
      }

      const typedGroup = group as {
        founder_jid?: string;
        name?: string;
        bot_mission?: string;
        created_at?: string;
      } | null;

      // Count active warnings
      const { count: warningCount } = await supabase
        .from('user_warnings')
        .select('*', { count: 'exact', head: true })
        .eq('group_jid', groupJid);

      // Count filters
      const { count: filterCount } = await supabase
        .from('group_filters')
        .select('*', { count: 'exact', head: true })
        .eq('group_jid', groupJid);

      // Mission author (stored in founder_jid)
      const missionAuthor = typedGroup?.founder_jid;

      let missionDesc = 'Not defined';
      if (typedGroup?.bot_mission) {
        missionDesc =
          typedGroup.bot_mission.length > 50
            ? typedGroup.bot_mission.substring(0, 47) + '...'
            : typedGroup.bot_mission;
      }

      const stats = [
        '📊 **Group Statistics**',
        '',
        `👥 Admins (Bot): ${adminCount}`,
        `⚠️ Active Warnings: ${warningCount || 0}`,
        `🔍 Configured Filters: ${filterCount || 0}`,
        '',
        '📝 **Mission & Goals**',
        `> Title: ${typedGroup?.name || 'N/A'}`,
        `> Author: ${missionAuthor ? '@' + missionAuthor.split('@')[0] : 'Unknown'}`,
        `> Desc: ${missionDesc}`,
      ];

      if (typedGroup?.created_at) {
        const date = new Date(typedGroup.created_at).toLocaleDateString('en-US');
        stats.push(`📅 Created on: ${date}`);
      }

      return {
        success: true,
        message: stats.join('\n'),
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Error fetching stats: ${err.message}` };
    }
  },

  // =================================================================
  // MISSING COMMANDS (Implementations)
  // =================================================================

  /**
   * Unmutes a user
   */
  async _unmuteUser(groupJid: string, args: GroupManagerArgs, message: GroupManagerMessage) {
    try {
      const { redis: redisClient } = await import('../../../services/redisClient.js');

      let targetJid = args.user_jid || '';
      if (!targetJid && message.quoted?.sender) {
        targetJid = message.quoted.sender;
      }
      const msg = message.raw as {
        message?: { extendedTextMessage?: { contextInfo?: { mentionedJid?: string[] } } };
      } | null;
      if (!targetJid && msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
        targetJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
      }

      if (!targetJid) {
        return { success: false, message: '❌ No user specified.' };
      }

      const muteKey = `mute:${groupJid}:${targetJid}`;

      if (!redisClient.isReady) {
        return { success: false, message: '❌ Redis not available.' };
      }

      const exists = await redisClient.exists(muteKey);
      if (!exists) {
        return {
          success: true,
          message: `🔊 ${targetJid.split('@')[0]} was not muted (or mute expired).`,
        };
      }

      await redisClient.del(muteKey);
      return { success: true, message: `🔊 ${targetJid.split('@')[0]} can speak again.` };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Unmute error: ${err.message}` };
    }
  },

  /**
   * Promotes a member to administrator
   */
  async _promoteUser(
    groupJid: string,
    args: GroupManagerArgs,
    message: GroupManagerMessage,
    transport: GroupManagerTransport,
  ) {
    try {
      let targetJid = args.user_jid || '';
      if (!targetJid && message.quoted?.sender) {
        targetJid = message.quoted.sender;
      }
      const msg = message.raw as {
        message?: { extendedTextMessage?: { contextInfo?: { mentionedJid?: string[] } } };
      } | null;
      if (!targetJid && msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
        targetJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
      }

      if (!targetJid) {
        return { success: false, message: '❌ No user specified.' };
      }

      await transport.sock.groupParticipantsUpdate(groupJid, [targetJid], 'promote');
      return { success: true, message: `👑 @${targetJid.split('@')[0]} is now an admin!` };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[GroupManager] Promote error:', err);
      return { success: false, message: `Promotion error: ${err.message}` };
    }
  },

  /**
   * Removes administrator rights from a member
   */
  async _demoteUser(
    groupJid: string,
    args: GroupManagerArgs,
    message: GroupManagerMessage,
    transport: GroupManagerTransport,
  ) {
    try {
      let targetJid = args.user_jid || '';
      if (!targetJid && message.quoted?.sender) {
        targetJid = message.quoted.sender;
      }
      const msg = message.raw as {
        message?: { extendedTextMessage?: { contextInfo?: { mentionedJid?: string[] } } };
      } | null;
      if (!targetJid && msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
        targetJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
      }

      if (!targetJid) {
        return { success: false, message: '❌ No user specified.' };
      }

      await transport.sock.groupParticipantsUpdate(groupJid, [targetJid], 'demote');
      return { success: true, message: `📉 @${targetJid.split('@')[0]} is no longer an admin.` };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[GroupManager] Demote error:', err);
      return { success: false, message: `Demotion error: ${err.message}` };
    }
  },

  /**
   * Displays detailed group information
   */
  async _getGroupInfo(groupJid: string, transport: GroupManagerTransport) {
    try {
      const metadata = await transport.sock.groupMetadata(groupJid);

      const admins = metadata.participants
        .filter((p: { id: string; admin: string | null }) => p.admin)
        .map((p: { id: string; admin: string | null }) => `@${p.id.split('@')[0]}`);
      const memberCount = metadata.participants.length;

      const info = [
        '📋 **Group Info**',
        '',
        `📛 Name: ${metadata.subject}`,
        `📝 Description: ${metadata.desc || 'None'}`,
        `👥 Members: ${memberCount}`,
        `👑 Admins (${admins.length}): ${admins.slice(0, 5).join(', ')}${admins.length > 5 ? '...' : ''}`,
        `🔗 ID: ${groupJid}`,
      ];

      if (metadata.creation) {
        const createdDate = new Date(metadata.creation * 1000).toLocaleDateString('en-US');
        info.push(`📅 Created on: ${createdDate}`);
      }

      return { success: true, message: info.join('\n') };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[GroupManager] GroupInfo error:', err);
      return { success: false, message: `Error fetching info: ${err.message}` };
    }
  },

  /**
   * Kicks a user (Simple kick)
   */
  async _kickUser(
    chatId: string,
    args: GroupManagerArgs,
    message: GroupManagerMessage,
    transport: GroupManagerTransport,
  ) {
    // For now, Kick = Ban without persistent DB blacklist (just remove)
    const result = (await this._banUser(chatId, args, message, transport)) as {
      success: boolean;
      message?: string;
      error?: string;
    };
    if (result.success) {
      return {
        success: true,
        message: `👢 **KICK**: User kicked.\nReason: ${args.reason || 'None'}`,
      };
    }
    return result;
  },

  /**
   * Gives a warning
   */
  async _warnUser(chatId: string, args: GroupManagerArgs, message: GroupManagerMessage) {
    try {
      let targetJid = args.user_jid || '';
      // Résolution basique si manquant
      if (!targetJid && message.quoted?.sender) targetJid = message.quoted.sender;

      if (!targetJid) return { success: false, message: '❌ Target not found.' };

      // 1. Add warning
      await warningsDB.add(
        chatId,
        targetJid,
        args.reason || 'Inappropriate behavior',
        message.sender,
      );

      // Count current warnings
      const warnCount = await warningsDB.count(chatId, targetJid);

      // 2. Check limit
      const config = await configDB.get(chatId);
      const limit = config?.warning_limit || 3;

      let extraMsg = '';

      // 3. Auto-Ban if limit reached
      if (warnCount >= limit && config?.auto_ban) {
        extraMsg = `\n🚫 **LIMIT REACHED (${warnCount}/${limit})**: User should be banned (Auto-ban enabled).`;
      }

      return {
        success: true,
        message: `⚠️ **WARNING** for @${targetJid.split('@')[0]}\nCount: ${warnCount}/${limit}\nReason: ${args.reason || 'N/A'}${extraMsg}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Warn error: ${err.message}` };
    }
  },

  /**
   * Locks/Unlocks the group
   */
  async _lockGroup(chatId: string, args: GroupManagerArgs, transport: GroupManagerTransport) {
    try {
      const setting = args.action === 'lock' ? 'announcement' : 'not_announcement';
      await transport.updateGroupSetting(chatId, setting);

      const state = args.action === 'lock' ? '🔒 LOCKED' : '🔓 UNLOCKED';
      const desc = args.action === 'lock' ? 'Only admins can speak.' : 'Everyone can speak.';

      return {
        success: true,
        message: `Group ${state}\n${desc}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { success: false, message: `Lock/unlock error: ${err.message}` };
    }
  },
};
