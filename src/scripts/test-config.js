import appConfig from '../config/index.js';

console.log('✅ Configuration loaded and validated successfully!');
console.log('App Name:', appConfig.app.name);
console.log('Env:', appConfig.env);
console.log('Available Families:', appConfig.priorityFamilies);
console.log('Active Models:', Object.keys(appConfig.models.reglages_generaux.service_agents));
