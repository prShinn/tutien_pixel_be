const { DomainError } = require('../domain');
const { validateRequestId } = require('../inventory/inventory-service');
const { QUEST_DEFINITIONS } = require('./quest-catalog');

function createQuestService({ store, catalog }) {
  async function snapshot(userId) {
    return store.questSnapshot(userId, QUEST_DEFINITIONS);
  }

  async function mutate(userId, requestId, questId, action) {
    validateRequestId(requestId);
    if (!['accept', 'track', 'claim'].includes(action)) throw new DomainError('INVALID_QUEST_ACTION', 'Thao tác nhiệm vụ không hợp lệ');
    const result = await store.questAction(userId, requestId, String(questId || ''), action, QUEST_DEFINITIONS, catalog.listItems());
    return result.result;
  }

  async function applyEvent(userId, eventId, event) {
    validateRequestId(eventId);
    return (await store.applyQuestEvent(userId, eventId, event, QUEST_DEFINITIONS)).result;
  }

  return { snapshot, mutate, applyEvent };
}

module.exports = { createQuestService };
