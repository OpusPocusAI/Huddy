import { csv } from 'd3-fetch';
import API from './api';
import { getIndicatorData, getCountries } from '../services/worldBankApi';

/**
 * loadDataset function: Fetches data based on the dataset ID.
 * Make sure that the dataset id passed here exactly matches one of our cases.
 *
 * @param {string} datasetID - Identifier for the dataset.
 * @returns {Promise<Array>|null} - Processed data or null on error.
 */
export const loadDataset = async (datasetID) => {
  console.log("loadDataset called with datasetID:", datasetID);
  // Handle built-in datasets
  switch (datasetID) {
    case 'population':
      return await loadPopulationData();
    case 'life-expectancy':
      return await loadLifeExpectancyData();
    default:
      break;
  }
  // Handle GDP per capita PPP (constant 2011 international $) for all countries
  if (datasetID === 'NY.GDP.PCAP.PP.KD') {
    try {
      // Fetch list of countries to get their ISO2 codes for API
      const countryList = await getCountries();
      console.log('GDP load: fetched country list count:', countryList.length);
      const codes = countryList.map(c => c.iso2Code).filter(code => code);
      console.log('GDP load: ISO2 codes sample:', codes.slice(0,5));
      // Fetch per-country GDP per capita for all codes
      const seriesMap = await getIndicatorData(codes, datasetID);
      console.log('GDP load: seriesMap keys count:', Object.keys(seriesMap).length, 'sample:', Object.keys(seriesMap).slice(0,5));
      // Flatten map into array of {year, entity, iso, value}
      const data = codes.flatMap(code => (
        (seriesMap[code] || []).map(dp => ({
          year: +dp.date,
          entity: dp.country.value,
          iso: dp['countryiso3code'],
          value: dp.value != null ? +dp.value : null
        }))
      ));
      // Filter out invalid entries and sort by year
      const clean = data.filter(d => !isNaN(d.year) && d.value != null)
                        .sort((a,b) => a.year - b.year);
      console.log(`loadDataset GDP entries: ${clean.length}, sample:`, clean.slice(0,5));
      return clean;
    } catch (err) {
      console.error(`Error loading GDP per capita dataset:`, err);
      return [];
    }
  }
  // Handle World Bank indicators
  if (datasetID.includes('.')) {
    try {
      // First try world-level data
      const worldSeriesMap = await getIndicatorData('WLD', datasetID);
      const worldSeries = worldSeriesMap['WLD'] || [];

      if (worldSeries.length > 0) {
        // World data exists, use it
        console.log(`Indicator ${datasetID} returned ${worldSeries.length} world data points`);
        const worldData = worldSeries
          .map(dp => ({ year: +dp.date, entity: 'World', population: +dp.value, value: +dp.value }))
          .filter(d => !isNaN(d.year) && !isNaN(d.value))
          .sort((a, b) => a.year - b.year);
        return worldData;
      }

      // No world data - fetch for all countries instead
      console.log(`Indicator ${datasetID} has no world data, fetching for all countries...`);
      const countryList = await getCountries();
      const codes = countryList.map(c => c.iso2Code).filter(code => code).slice(0, 5); // Limit to 5 countries for faster loading
      console.log(`Fetching ${datasetID} for ${codes.length} countries:`, codes);

      const seriesMap = await getIndicatorData(codes, datasetID);
      const data = codes.flatMap(code => (
        (seriesMap[code] || []).map(dp => ({
          year: +dp.date,
          entity: dp.country.value,
          iso: dp['countryiso3code'],
          value: dp.value != null ? +dp.value : null
        }))
      ));

      const clean = data.filter(d => !isNaN(d.year) && d.value != null)
                        .sort((a,b) => a.year - b.year);
      console.log(`Indicator ${datasetID} loaded ${clean.length} entries from countries`);
      return clean.length > 0 ? clean : [];
    } catch (err) {
      console.error(`Error loading indicator ${datasetID}:`, err);
      return [];
    }
  }
  // Fallback: attempt to load custom dataset definitions from server
  try {
    const resp = await API.get('/api/datasets');
    const ds = resp.data.datasets.find(d => d.id === datasetID);
    if (!ds || !ds.url) throw new Error(`Dataset not found or missing URL: ${datasetID}`);
    const rawData = await csv(ds.url);
    if (!rawData || rawData.length === 0) return null;
    // Infer columns: year, entity, value
    const sample = rawData[0];
    const keys = Object.keys(sample);
    const yearKey = keys.find(k => /year/i.test(k)) || keys[0];
    const entityKey = keys.find(k => /entity|country|region/i.test(k)) || keys[1];
    const valueKey = keys.find(k => ![yearKey, entityKey].includes(k)) || keys[2];
    const processed = rawData
      .map(d => ({
        year: +d[yearKey],
        entity: d[entityKey],
        value: +d[valueKey]
      }))
      .filter(d => !isNaN(d.year) && !isNaN(d.value))
      .sort((a, b) => a.year - b.year);
    return processed;
  } catch (error) {
    console.error(`Error loading dataset ${datasetID}:`, error);
    return null;
  }
};

/**
 * loadPopulationData: Loads and processes the population CSV.
 */
export const loadPopulationData = async () => {
  try {
    // Fetch the CSV using the public URL (handled by CRA).
    const rawData = await csv(`${process.env.PUBLIC_URL}/data/population.csv`);
    
    // Extract all unique entities (regions/countries)
    const entities = [...new Set(rawData.map(d => d.Entity))];
    console.log("Available entities:", entities.slice(0, 20));
    
    // Map population data - include all entities, not just World
    const filteredData = rawData
      .map(d => ({
        year: +d.Year,
        population: +d['Population (historical)'],
        entity: d.Entity,
        value: +d['Population (historical)'] // Add value for consistency
      }))
      .filter(d => !isNaN(d.year) && !isNaN(d.population) && d.population > 0)
      .sort((a, b) => a.year - b.year);

    return filteredData;
  } catch (error) {
    console.error('Error loading population data:', error);
    return null;
  }
};

/**
 * loadLifeExpectancyData: Loads and processes the life expectancy CSV
 * from Our World in Data. We now remove the country parameter from the URL so that
 * we get a full dataset and then filter for a target entity. This helps in case the
 * "World" series is not returned by the API.
 */
export const loadLifeExpectancyData = async () => {
  try {
    // Remove the country filter so we get all the rows.
    const url = "https://ourworldindata.org/grapher/life-expectancy.csv?csvType=filtered&time=1800..2023";
    const rawData = await csv(url);
    console.log("Raw life expectancy data sample: ", rawData[0]);
    
    // Determine the key containing life expectancy data by searching for "life expectancy" in the header.
    const lifeExpKey = Object.keys(rawData[0]).find(key => key.toLowerCase().includes("life expectancy"));
    if (!lifeExpKey) {
      console.error("Could not determine life expectancy column key.");
      return [];
    }
    
    // See which entities are available in the data.
    const entities = Array.from(new Set(rawData.map(d => d.Entity)));
    console.log("Entities in life expectancy data:", entities.slice(0, 20));
    
    // Process the raw CSV for all entities: convert fields to numbers,
    // filter out any invalid rows, and sort by year.
    const processedData = rawData
      .map(d => ({
        year: +d.Year,
        lifeExpectancy: +d[lifeExpKey],
        entity: d.Entity,
        value: +d[lifeExpKey] // Add value for consistency
      }))
      .filter(d => !isNaN(d.year) && !isNaN(d.lifeExpectancy) && d.lifeExpectancy > 0)
      .sort((a, b) => a.year - b.year);
      
    return processedData;
  } catch (error) {
    console.error('Error loading life expectancy data:', error);
    return null;
  }
}; 

/**
 * getAvailableDatasets: Returns a list of static and custom datasets.
 * @returns {Promise<Array>} - Array of dataset objects with id, title, and description.
 */
export const getAvailableDatasets = async () => {
  const builtins = [
    { id: 'population', title: 'World Population' },
    { id: 'life-expectancy', title: 'Life Expectancy' },
    { id: 'NY.GDP.PCAP.PP.KD', title: 'GDP per Capita (PPP)' }
  ];
  try {
    const dsRes = await API.get('/api/datasets');
    return [...builtins, ...(dsRes.data.datasets || [])];
  } catch (err) {
    console.error('Error fetching datasets, using builtins:', err);
    return builtins;
  }
};