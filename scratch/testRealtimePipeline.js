const { runFullAnalysis } = require('../src/derivatives');

async function test() {
  console.log('Testing runFullAnalysis()...');
  try {
    const analysis = await runFullAnalysis();
    console.log('Direction:', analysis.scoreResult.direction);
    console.log('Supply/Demand Summary:', analysis.supplyDemandResult?.summaryText);
    console.log('Consensus:', analysis.supplyDemandResult?.consensus);
    console.log('Success! Pipeline is healthy.');
  } catch (e) {
    console.error('Error during runFullAnalysis:', e);
  }
}

test();
