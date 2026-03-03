module.exports = {
  data: {
    name: 'uptime',
    description: 'Lihat uptime bot saat ini'
  },
  cooldownMs: 5000,
  async execute(interaction) {
    const total = Math.floor(process.uptime());
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    await interaction.reply({
      content: `⏱️ Uptime: ${hours}j ${minutes}m ${seconds}d`,
      ephemeral: true
    });
  }
};
