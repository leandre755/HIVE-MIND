import AjvClient from 'ajv';
console.log('Ajv loaded:', typeof AjvClient);
const ajv = new AjvClient();
console.log('ajv instance:', !!ajv);
