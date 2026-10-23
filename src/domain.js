class DomainError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function publicPlayer(player, wallet, inventory) {
  return {
    id: player.id, userId: player.userId, name: player.name, realmCode: player.realmCode,
    realmStage: player.realmStage, tuVi: player.tuVi, mapCode: player.mapCode,
    x: player.x, y: player.y, version: player.version, stats: player.stats,
    wallet: { xu: wallet?.xu || 0, linhThach: wallet?.linhThach || 0 },
    inventory: inventory.map(({ id, itemCode, quantity, slot }) => ({ id, itemCode, quantity, slot })),
  };
}

module.exports = { DomainError, publicUser, publicPlayer };
