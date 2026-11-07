const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendRoot, '.env'), quiet: true });

const config = require('../src/config');
const { createCatalogService } = require('../src/catalog/catalog-service');
const { createMysqlStore } = require('../src/store/mysql-store');

const ACTOR = 'system:weapon-catalog-v1';
const itemCodes = [
  'WEAPON_CUNG_GO',
  'WEAPON_BUA_DONG',
  'WEAPON_CHUY_SAT',
  'WEAPON_THUONG_TRUC',
  'WEAPON_NO_CO_QUAN',
  'WEAPON_DAO_LIEU_DIEP',
];
const skillCodes = [
  'LINH_QUANG_DAN',
  'XUYEN_PHONG_TIEN',
  'BUA_SON_TACH',
  'CHUY_THIET_COT',
  'DAO_LIET_NGUYET',
  'THUONG_BACH_BO',
  'CUNG_LIEN_CHAU',
  'NO_PHA_GIAP',
];

async function persistNewContent(store, collection, records, definitions) {
  let inserted = 0;
  let unchanged = 0;
  for (const id of records) {
    const definition = definitions.get(id);
    if (!definition) throw new Error('CATALOG_ENTRY_MISSING: ' + id);
    const current = await store.getAdminContentRecord(collection, id);
    if (current) {
      if (current.deleted || JSON.stringify(current.data) !== JSON.stringify(definition)) {
        throw new Error('CATALOG_ENTRY_CONFLICT: ' + collection + '/' + id);
      }
      unchanged += 1;
      continue;
    }
    const requestId = 'weapon_catalog_v1_' + collection + '_' + id;
    await store.mutateAdminContent(
      ACTOR,
      collection,
      id,
      definition,
      false,
      requestId,
      true,
      0,
    );
    const saved = await store.getAdminContentRecord(collection, id);
    if (!saved || saved.deleted || JSON.stringify(saved.data) !== JSON.stringify(definition)) {
      throw new Error('CATALOG_PERSISTENCE_MISMATCH: ' + collection + '/' + id);
    }
    inserted += 1;
  }
  return { inserted, unchanged };
}

async function main() {
  const catalog = createCatalogService();
  const store = createMysqlStore(config.db);
  try {
    await store.init();
    for (const record of await store.listAdminContentRecords('items')) {
      catalog.applyAdminRecord('items', record.id, record);
    }
    const itemDefinitions = new Map(catalog.getAdminCollection('items').map((item) => [item.id, item]));
    const skillDefinitions = new Map(catalog.getAdminCollection('skills').map((skill) => [skill.code, skill]));
    const itemCounts = await persistNewContent(store, 'items', itemCodes, itemDefinitions);
    const skillCounts = await persistNewContent(store, 'skills', skillCodes, skillDefinitions);
    console.log(JSON.stringify({
      operation: 'weapon_catalog_persisted',
      items: itemCounts,
      skills: skillCounts,
      actor: ACTOR,
    }));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    operation: 'weapon_catalog_failed',
    code: error.code || 'WEAPON_CATALOG_IMPORT_FAILED',
    message: error.message,
  }));
  process.exitCode = 1;
});
