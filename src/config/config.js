module.exports = {
  token: process.env.DISCORD_TOKEN || process.env.CONTROLLER_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID || process.env.CONTROLLER_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || process.env.CONTROLLER_GUILD_ID
};
