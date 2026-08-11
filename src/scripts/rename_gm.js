import { readFileSync, writeFileSync } from 'fs';

const file = 'plugins/whatsapp/group_manager/index.ts';
let content = readFileSync(file, 'utf8');

// Remplacer toutes les occurrences de gm_ par whatsapp_
content = content.replace(/\bgm_/g, 'whatsapp_');

writeFileSync(file, content, 'utf8');
console.log('Remplacement effectué avec succès.');
