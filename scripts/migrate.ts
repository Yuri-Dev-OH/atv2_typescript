import { criarBanco } from '../src/infrastructure/database.js';
const banco = criarBanco(process.env.DATABASE_URL ?? '');
await banco.initialize();
try { console.log('Migrações aplicadas:', (await banco.runMigrations()).map(m => m.name)); }
finally { await banco.destroy(); }
