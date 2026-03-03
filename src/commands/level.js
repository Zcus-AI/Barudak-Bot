const levelStore = new Map();

module.exports = {
  data: {
    name: 'level',
    description: 'Cek level mock sederhana kamu'
  },
  cooldownMs: 5000,
  async execute(interaction) {
    const userId = interaction.user.id;
    const current = levelStore.get(userId) || { xp: 0, level: 1 };
    current.xp += 15;
    if (current.xp >= current.level * 100) {
      current.xp = 0;
      current.level += 1;
    }
    levelStore.set(userId, current);

    await interaction.reply({
      content: `📈 Level kamu: ${current.level} | XP: ${current.xp}/${current.level * 100}`,
      ephemeral: true
    });
  }
};
