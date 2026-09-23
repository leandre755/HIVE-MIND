import { safeReadFileSync, safeWriteFileSync } from '../utils/safeFs.js';

const file = 'plugins/whatsapp/group_manager/index.ts';
let content = safeReadFileSync(file);

// Remplacer toutes les occurrences de gm_ par whatsapp_
content = content.replace(/\bgm_/g, 'whatsapp_');

safeWriteFileSync(file, content, 'utf8');
console.log('Remplacement effectué avec succès.');
