#!/usr/bin/env node
/**
 * Automated test for globe data loading
 * Tests the data pipeline without requiring UI interaction
 *
 * Usage: node test-globe-data.js
 */

const BASE_URL = 'https://api.worldbank.org/v2';

async function getIndicatorDataAllCountries(indicator, start = 1960, end = 2024) {
  const url = new URL(`${BASE_URL}/country/all/indicator/${indicator}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('per_page', '32500');
  url.searchParams.set('date', `${start}:${end}`);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json) || json.length < 2) return [];
    return json[1] || [];
  } catch (err) {
    console.error(`Failed to fetch ${indicator}:`, err.message);
    return [];
  }
}

async function testDataset(indicatorId, indicatorName) {
  console.log(`\n🧪 Testing: ${indicatorName} (${indicatorId})`);
  console.log('═'.repeat(60));

  const data = await getIndicatorDataAllCountries(indicatorId, 1800, 2030);

  if (data.length === 0) {
    console.log('❌ No data returned');
    return false;
  }

  // Process data like DatasetContext does
  const normalized = data
    .map(d => ({
      year: Number(d.date),
      entity: d.country?.value || 'Unknown',
      iso: d.countryiso3code,
      value: d.value != null ? Number(d.value) : null
    }))
    .filter(d => !isNaN(d.year) && d.value != null && d.entity !== 'Unknown');

  const countries = new Set(normalized.map(d => d.entity));
  const years = Array.from(new Set(normalized.map(d => d.year))).sort((a, b) => a - b);

  console.log(`✅ Data loaded successfully:`);
  console.log(`   📊 Records: ${normalized.length.toLocaleString()}`);
  console.log(`   🌍 Countries: ${countries.size}`);
  console.log(`   📅 Years: ${years[0]} - ${years[years.length - 1]}`);
  console.log(`   🎯 Default year: ${years[years.length - 1]}`);

  // Test globe coloring logic
  const testYear = years[years.length - 1];
  const yearData = normalized.filter(d => d.year === testYear);
  const maxValue = Math.max(...yearData.map(d => d.value));

  // Find USA data as test case
  const usaData = yearData.find(d => d.entity === 'United States' || d.iso === 'USA');
  if (usaData) {
    const t = maxValue > 0 ? usaData.value / maxValue : 0;
    console.log(`   🇺🇸 USA ${testYear}: ${usaData.value.toLocaleString()} (normalized: ${(t * 100).toFixed(1)}%)`);
  }

  return true;
}

async function runTests() {
  console.log('\n🚀 Globe Data Loading Tests');
  console.log('Testing World Bank API integration and data processing\n');

  const tests = [
    { id: 'NY.GDP.MKTP.KD.ZG', name: 'GDP growth (annual %)' },
    { id: 'SP.POP.TOTL', name: 'Population, total' },
    { id: '2.4_OOSC.RATE', name: 'Out-of-school children rate' },
    { id: 'EN.ATM.CO2E.PC', name: 'CO2 emissions (metric tons per capita)' }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const success = await testDataset(test.id, test.name);
    if (success) passed++;
    else failed++;

    // Rate limit to avoid hitting API too hard
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`📈 Test Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('✅ All tests passed! Globe data loading works correctly.\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Check API availability.\n');
    process.exit(1);
  }
}

runTests();
