module.exports = {
  data: {
    name: 'ping',
    description: 'Balas dengan Pong!'
  },
  cooldownMs: 3000,
  async execute(interaction) {
    await interaction.reply({ content: '🏓 Pong!', ephemeral: true });
  }
};
