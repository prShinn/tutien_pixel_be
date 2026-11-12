const { DomainError } = require('../domain');

function validateRequestId(requestId) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
    throw new DomainError('INVALID_REQUEST_ID', 'requestId phải dài 8-80 ký tự');
  }
}

function createRetentionService({ store, catalog, players }) {
  async function getStatus(userId) {
    return store.getRetentionState(userId);
  }

  async function claimCheckin(userId, requestId) {
    validateRequestId(requestId);
    const mutation = await store.claimDailyCheckin(userId, requestId, catalog.listItems());
    return { player: players.decorate(mutation.player), result: mutation.result };
  }

  return { getStatus, claimCheckin };
}

module.exports = { createRetentionService };
