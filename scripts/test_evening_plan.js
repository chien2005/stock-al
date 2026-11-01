const { buildEveningPlanNotification, runEveningPlanJob } = require('../src/derivatives/eveningPlanEngine');

async function test() {
  console.log('🧪 Testing buildEveningPlanNotification and send...');
  try {
    const msg = await buildEveningPlanNotification();
    console.log('\n--- PREVIEW NOTIFICATION ---');
    console.log(msg);
    console.log('\n--- SENDING TO TELEGRAM DERIVATIVES CHANNEL ---');
    const success = await runEveningPlanJob();
    console.log('Result:', success ? 'SUCCESS' : 'FAILED');
  } catch (e) {
    console.error('Error during test:', e);
  }
}

test();
