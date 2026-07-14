const { config } = require('../src/config');

console.log('=== VERIFYING RESOLVED CONFIG KEYS ===');
console.log('geminiAI1 key:', config.geminiAI1.apiKey ? '✅ PRESENT' : '❌ EMPTY');
console.log('geminiAI2 key:', config.geminiAI2.apiKey === config.geminiAI1.apiKey ? '✅ FALLBACK TO AI1' : '⚠️ UNIQUE OR OTHER');
console.log('geminiAI3 key:', config.geminiAI3.apiKey ? '✅ PRESENT' : '❌ EMPTY');
console.log('geminiAI4 key:', config.geminiAI4.apiKey === config.geminiAI1.apiKey ? '✅ FALLBACK TO AI1' : '⚠️ UNIQUE OR OTHER');

console.log('Values:');
console.log('AI1:', config.geminiAI1.apiKey ? `${config.geminiAI1.apiKey.substring(0, 8)}...` : 'empty');
console.log('AI2:', config.geminiAI2.apiKey ? `${config.geminiAI2.apiKey.substring(0, 8)}...` : 'empty');
console.log('AI3:', config.geminiAI3.apiKey ? `${config.geminiAI3.apiKey.substring(0, 8)}...` : 'empty');
console.log('AI4:', config.geminiAI4.apiKey ? `${config.geminiAI4.apiKey.substring(0, 8)}...` : 'empty');
