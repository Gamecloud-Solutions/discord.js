const Channel = require('./Channel');
const Role = require('./Role');
const Invite = require('./Invite');
const PermissionOverwrites = require('./PermissionOverwrites');
const Permissions = require('../util/Permissions');
const Collection = require('../util/Collection');
const Constants = require('../util/Constants');
const { TypeError } = require('../errors');

/**
 * Represents a guild channel (i.e. text channels and voice channels).
 * @extends {Channel}
 */
class GuildChannel extends Channel {
  constructor(guild, data) {
    super(guild.client, data);

    /**
     * The guild the channel is in
     * @type {Guild}
     */
    this.guild = guild;
  }

  _patch(data) {
    super._patch(data);

    /**
     * The name of the guild channel
     * @type {string}
     */
    this.name = data.name;

    /**
     * The position of the channel in the list
     * @type {number}
     */
    this.position = data.position;

    /**
     * A map of permission overwrites in this channel for roles and users
     * @type {Collection<Snowflake, PermissionOverwrites>}
     */
    this.permissionOverwrites = new Collection();
    if (data.permission_overwrites) {
      for (const overwrite of data.permission_overwrites) {
        this.permissionOverwrites.set(overwrite.id, new PermissionOverwrites(this, overwrite));
      }
    }
  }

  /**
   * The position of the channel
   * @type {number}
   * @readonly
   */
  get calculatedPosition() {
    const sorted = this.guild._sortedChannels(this.type);
    return sorted.array().indexOf(sorted.get(this.id));
  }

  /**
   * Gets the overall set of permissions for a user in this channel, taking into account roles and permission
   * overwrites.
   * @param {GuildMemberResolvable} member The user that you want to obtain the overall permissions for
   * @returns {?Permissions}
   */
  permissionsFor(member) {
    member = this.client.resolver.resolveGuildMember(this.guild, member);
    if (!member) return null;
    if (member.id === this.guild.ownerID) return new Permissions(Permissions.ALL);

    let permissions = 0;

    const roles = member.roles;
    for (const role of roles.values()) permissions |= role.permissions;

    const overwrites = this.overwritesFor(member, true, roles);

    if (overwrites.everyone) {
      permissions &= ~overwrites.everyone._denied;
      permissions |= overwrites.everyone._allowed;
    }

    let allow = 0;
    for (const overwrite of overwrites.roles) {
      permissions &= ~overwrite._denied;
      allow |= overwrite._allowed;
    }
    permissions |= allow;

    if (overwrites.member) {
      permissions &= ~overwrites.member._denied;
      permissions |= overwrites.member._allowed;
    }

    const admin = Boolean(permissions & Permissions.FLAGS.ADMINISTRATOR);
    if (admin) permissions = Permissions.ALL;

    return new Permissions(permissions);
  }

  overwritesFor(member, verified = false, roles = null) {
    if (!verified) member = this.client.resolver.resolveGuildMember(this.guild, member);
    if (!member) return [];

    roles = roles || member.roles;
    const roleOverwrites = [];
    let memberOverwrites;
    let everyoneOverwrites;

    for (const overwrite of this.permissionOverwrites.values()) {
      if (overwrite.id === this.guild.id) {
        everyoneOverwrites = overwrite;
      } else if (roles.has(overwrite.id)) {
        roleOverwrites.push(overwrite);
      } else if (overwrite.id === member.id) {
        memberOverwrites = overwrite;
      }
    }

    return {
      everyone: everyoneOverwrites,
      roles: roleOverwrites,
      member: memberOverwrites,
    };
  }

  /**
   * An object mapping permission flags to `true` (enabled), `null` (default) or `false` (disabled).
   * ```js
   * {
   *  'SEND_MESSAGES': true,
   *  'EMBED_LINKS': null,
   *  'ATTACH_FILES': false,
   * }
   * ```
   * @typedef {Object} PermissionOverwriteOptions
   */

  /**
   * Overwrites the permissions for a user or role in this channel.
   * @param {RoleResolvable|UserResolvable} userOrRole The user or role to update
   * @param {PermissionOverwriteOptions} options The configuration for the update
   * @param {string} [reason] Reason for creating/editing this overwrite
   * @returns {Promise<GuildChannel>}
   * @example
   * // Overwrite permissions for a message author
   * message.channel.overwritePermissions(message.author, {
   *   SEND_MESSAGES: false
   * })
   *   .then(() => console.log('Done!'))
   *   .catch(console.error);
   */
  overwritePermissions(userOrRole, options, reason) {
    const payload = {
      allow: 0,
      deny: 0,
    };

    if (userOrRole instanceof Role) {
      payload.type = 'role';
    } else if (this.guild.roles.has(userOrRole)) {
      userOrRole = this.guild.roles.get(userOrRole);
      payload.type = 'role';
    } else {
      userOrRole = this.client.resolver.resolveUser(userOrRole);
      payload.type = 'member';
      if (!userOrRole) return Promise.reject(new TypeError('INVALID_TYPE', 'parameter', 'User nor a Role', true));
    }

    payload.id = userOrRole.id;

    const prevOverwrite = this.permissionOverwrites.get(userOrRole.id);

    if (prevOverwrite) {
      payload.allow = prevOverwrite._allowed;
      payload.deny = prevOverwrite._denied;
    }

    for (const perm in options) {
      if (options[perm] === true) {
        payload.allow |= Permissions.FLAGS[perm] || 0;
        payload.deny &= ~(Permissions.FLAGS[perm] || 0);
      } else if (options[perm] === false) {
        payload.allow &= ~(Permissions.FLAGS[perm] || 0);
        payload.deny |= Permissions.FLAGS[perm] || 0;
      } else if (options[perm] === null) {
        payload.allow &= ~(Permissions.FLAGS[perm] || 0);
        payload.deny &= ~(Permissions.FLAGS[perm] || 0);
      }
    }

    return this.client.api.channels(this.id).permissions[payload.id]
      .put({ data: payload, reason })
      .then(() => this);
  }

  /**
   * A collection of members that can see this channel, mapped by their ID
   * @type {Collection<Snowflake, GuildMember>}
   * @readonly
   */
  get members() {
    const members = new Collection();
    for (const member of this.guild.members.values()) {
      if (this.permissionsFor(member).has('VIEW_CHANNEL')) {
        members.set(member.id, member);
      }
    }
    return members;
  }

  /**
   * The data for a guild channel.
   * @typedef {Object} ChannelData
   * @property {string} [name] The name of the channel
   * @property {number} [position] The position of the channel
   * @property {string} [topic] The topic of the text channel
   * @property {number} [bitrate] The bitrate of the voice channel
   * @property {number} [userLimit] The user limit of the voice channel
   */

  /**
   * Edits the channel.
   * @param {ChannelData} data The new data for the channel
   * @param {string} [reason] Reason for editing this channel
   * @returns {Promise<GuildChannel>}
   * @example
   * // Edit a channel
   * channel.edit({name: 'new-channel'})
   *   .then(c => console.log(`Edited channel ${c}`))
   *   .catch(console.error);
   */
  edit(data, reason) {
    return this.client.api.channels(this.id).patch({
      data: {
        name: (data.name || this.name).trim(),
        topic: data.topic || this.topic,
        position: data.position || this.position,
        bitrate: data.bitrate || (this.bitrate ? this.bitrate * 1000 : undefined),
        user_limit: data.userLimit || this.userLimit,
      },
      reason,
    }).then(newData => {
      const clone = this._clone();
      clone._patch(newData);
      return clone;
    });
  }

  /**
   * Set a new name for the guild channel.
   * @param {string} name The new name for the guild channel
   * @param {string} [reason] Reason for changing the guild channel's name
   * @returns {Promise<GuildChannel>}
   * @example
   * // Set a new channel name
   * channel.setName('not_general')
   *   .then(newChannel => console.log(`Channel's new name is ${newChannel.name}`))
   *   .catch(console.error);
   */
  setName(name, reason) {
    return this.edit({ name }, reason);
  }

  /**
   * Set a new position for the guild channel.
   * @param {number} position The new position for the guild channel
   * @param {boolean} [relative=false] Move the position relative to its current value
   * @returns {Promise<GuildChannel>}
   * @example
   * // Set a new channel position
   * channel.setPosition(2)
   *   .then(newChannel => console.log(`Channel's new position is ${newChannel.position}`))
   *   .catch(console.error);
   */
  setPosition(position, relative) {
    return this.guild.setChannelPosition(this, position, relative).then(() => this);
  }

  /**
   * Set a new topic for the guild channel.
   * @param {string} topic The new topic for the guild channel
   * @param {string} [reason] Reason for changing the guild channel's topic
   * @returns {Promise<GuildChannel>}
   * @example
   * // Set a new channel topic
   * channel.setTopic('needs more rate limiting')
   *   .then(newChannel => console.log(`Channel's new topic is ${newChannel.topic}`))
   *   .catch(console.error);
   */
  setTopic(topic, reason) {
    return this.edit({ topic }, reason);
  }

  /**
   * Create an invite to this guild channel.
   * @param {Object} [options={}] Options for the invite
   * @param {boolean} [options.temporary=false] Whether members that joined via the invite should be automatically
   * kicked after 24 hours if they have not yet received a role
   * @param {number} [options.maxAge=86400] How long the invite should last (in seconds, 0 for forever)
   * @param {number} [options.maxUses=0] Maximum number of uses
   * @param {boolean} [options.unique=false] Create a unique invite, or use an existing one with similar settings
   * @param {string} [options.reason] Reason for creating this
   * @returns {Promise<Invite>}
   */
  createInvite({ temporary = false, maxAge = 86400, maxUses = 0, unique, reason } = {}) {
    return this.client.api.channels(this.id).invites.post({ data: {
      temporary, max_age: maxAge, max_uses: maxUses, unique,
    }, reason })
      .then(invite => new Invite(this.client, invite));
  }

  /**
   * Clone this channel.
   * @param {Object} [options] The options
   * @param {string} [options.name=this.name] Optional name for the new channel, otherwise it has the name
   * of this channel
   * @param {boolean} [options.withPermissions=true] Whether to clone the channel with this channel's
   * permission overwrites
   * @param {boolean} [options.withTopic=true] Whether to clone the channel with this channel's topic
   * @param {string} [options.reason] Reason for cloning this channel
   * @returns {Promise<GuildChannel>}
   */
  clone({ name = this.name, withPermissions = true, withTopic = true, reason } = {}) {
    const options = { overwrites: withPermissions ? this.permissionOverwrites : [], reason };
    return this.guild.createChannel(name, this.type, options)
      .then(channel => withTopic ? channel.setTopic(this.topic) : channel);
  }

  /**
   * Checks if this channel has the same type, topic, position, name, overwrites and ID as another channel.
   * In most cases, a simple `channel.id === channel2.id` will do, and is much faster too.
   * @param {GuildChannel} channel Channel to compare with
   * @returns {boolean}
   */
  equals(channel) {
    let equal = channel &&
      this.id === channel.id &&
      this.type === channel.type &&
      this.topic === channel.topic &&
      this.position === channel.position &&
      this.name === channel.name;

    if (equal) {
      if (this.permissionOverwrites && channel.permissionOverwrites) {
        equal = this.permissionOverwrites.equals(channel.permissionOverwrites);
      } else {
        equal = !this.permissionOverwrites && !channel.permissionOverwrites;
      }
    }

    return equal;
  }

  /**
   * Whether the channel is deletable by the client user
   * @type {boolean}
   * @readonly
   */
  get deletable() {
    return this.id !== this.guild.id &&
      this.permissionsFor(this.client.user).has(Permissions.FLAGS.MANAGE_CHANNELS);
  }

  /**
   * Deletes this channel.
   * @param {string} [reason] Reason for deleting this channel
   * @returns {Promise<GuildChannel>}
   * @example
   * // Delete the channel
   * channel.delete('making room for new channels')
   *   .then() // Success
   *   .catch(console.error); // Log error
   */
  delete(reason) {
    return this.client.api.channels(this.id).delete({ reason }).then(() => this);
  }

  /**
   * Whether the channel is muted
   * <warn>This is only available when using a user account.</warn>
   * @type {?boolean}
   * @readonly
   */
  get muted() {
    if (this.client.user.bot) return null;
    try {
      return this.client.user.guildSettings.get(this.guild.id).channelOverrides.get(this.id).muted;
    } catch (err) {
      return false;
    }
  }

  /**
   * The type of message that should notify you
   * one of `EVERYTHING`, `MENTIONS`, `NOTHING`, `INHERIT`
   * <warn>This is only available when using a user account.</warn>
   * @type {?string}
   * @readonly
   */
  get messageNotifications() {
    if (this.client.user.bot) return null;
    try {
      return this.client.user.guildSettings.get(this.guild.id).channelOverrides.get(this.id).messageNotifications;
    } catch (err) {
      return Constants.MessageNotificationTypes[3];
    }
  }

  /**
   * When concatenated with a string, this automatically returns the channel's mention instead of the Channel object.
   * @returns {string}
   * @example
   * // Outputs: Hello from #general
   * console.log(`Hello from ${channel}`);
   * @example
   * // Outputs: Hello from #general
   * console.log('Hello from ' + channel);
   */
  toString() {
    return `<#${this.id}>`;
  }
}

module.exports = GuildChannel;
