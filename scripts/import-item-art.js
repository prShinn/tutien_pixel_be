const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const backendRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendRoot, '.env'), quiet: true });
const config = require('../src/config');
const { createMysqlStore } = require('../src/store/mysql-store');
const { createCatalogService } = require('../src/catalog/catalog-service');

const ACTOR = 'system:item-art-v2';
const publicRoot = path.resolve(backendRoot, '../tutien_pixel/public');
const manifestPath = path.join(publicRoot, 'assets/items/catalog-v2/manifest.json');
const backupPath = path.join(backendRoot, 'reports/item-art-v2-before.json');

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 2 || !Array.isArray(manifest.items)) throw new Error('INVALID_ART_MANIFEST');
  const store = createMysqlStore(config.db);
  try {
    await store.init();
    const catalog = createCatalogService();
    const overrides = await store.listAdminContentRecords('items');
    for (const record of overrides) catalog.applyAdminRecord('items', record.id, record);
    const items = new Map(catalog.getAdminCollection('items').map((item) => [item.id, item]));
    if (manifest.items.length !== items.size) throw new Error('INCOMPLETE_ART_MANIFEST');
    const seen = new Set();
    const pending = [];
    let alreadyApplied = 0;
    for (const entry of manifest.items) {
      if (seen.has(entry.id)) throw new Error('DUPLICATE_ART_ID');
      seen.add(entry.id);
      const item = items.get(entry.id);
      if (!item || (item.type || item.loai) !== entry.type || (item.slot || null) !== entry.slot
          || (item.name || item.tenDo) !== entry.name) throw new Error('ITEM_ART_IDENTITY_CHANGED: ' + entry.id);
      const expectedPath = './assets/items/catalog-v2/' + entry.id.toLowerCase() + '.png';
      if (!/^[A-Za-z0-9_-]+$/.test(entry.id) || entry.img !== expectedPath) throw new Error('INVALID_ART_PATH');
      const asset = path.join(publicRoot, entry.img.slice(2));
      const hash = crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex');
      if (hash !== entry.sha256) throw new Error('ART_HASH_CHANGED: ' + entry.id);
      const prior = await store.getAdminContentRecord('items', entry.id);
      if ((prior?.data?.img || item.img || null) === entry.img) { alreadyApplied += 1; continue; }
      if ((prior?.data?.img || item.img || null) !== entry.previousImg) throw new Error('ITEM_IMAGE_CHANGED: ' + entry.id);
      pending.push({ entry, item, prior });
    }
    console.log(JSON.stringify({ operation: 'item_art_audit', items: items.size, persistedOverrides: overrides.length, plannedImages: manifest.items.length, pending: pending.length, alreadyApplied }));
    if (!process.argv.includes('--apply')) return;
    if (!pending.length) return;
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, JSON.stringify({ actor: ACTOR, items: pending.map(({ entry, item, prior }) => ({ id: entry.id, original: item, prior })) }, null, 2), { flag: 'wx' });
    }
    let updated = 0;
    for (const { entry, item, prior } of pending) {
      const requestId = 'item_art_v2_' + crypto.createHash('sha256').update(entry.id).digest('hex').slice(0, 24);
      const document = { ...item, img: entry.img };
      await store.mutateAdminContent(ACTOR, 'items', entry.id, document, false, requestId, false, Number(prior?.version || 0));
      const saved = await store.getAdminContentRecord('items', entry.id);
      require('node:assert/strict').deepEqual(saved?.data, document, 'PERSISTED_ITEM_MISMATCH: ' + entry.id);
      updated += 1;
    }
    console.log(JSON.stringify({ operation: 'item_art_applied', updated, alreadyApplied, backup: backupPath }));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ operation: 'item_art_failed', code: error.code || 'ART_IMPORT_FAILED', message: error.message }));
  process.exitCode = 1;
});
