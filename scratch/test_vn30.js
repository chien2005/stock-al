const { fetchVN30Index } = require('../src/stockService');

async function test() {
  try {
    console.log('Fetching VN30 index...');
    const result = await fetchVN30Index();
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
