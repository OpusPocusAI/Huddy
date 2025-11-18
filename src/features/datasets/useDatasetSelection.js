import { useCallback } from 'react';

export default function useDatasetSelection({
  ctxAvailable,
  datasetSearchResults,
  selectDatasetFromProvider,
  setSelectedDataset,
  setIsGlobeReset,
  setActiveGlobeDataset,
  setShowGlobe,
  setShowGraph,
  setActiveDataset,
  setPopulationData,
  setLifeExpData,
  setGdpData,
  setSelectedRegion,
  setSelectedPopulationYear,
  setSelectedLifeExpYear,
  setSelectedGdpYear,
  setGlobeDataError,
}) {
  const handleDatasetSelect = useCallback(async (datasetId, displayType = 'graph') => {
    setSelectedDataset && setSelectedDataset(datasetId);
    let ds = (ctxAvailable || []).find(d => d.id === datasetId);
    if (!ds) {
      const fromSearch = (datasetSearchResults || []).find(r => r.id === datasetId);
      ds = fromSearch ? { id: fromSearch.id, title: fromSearch.name } : { id: datasetId, title: datasetId };
    }
    if (displayType === 'globe') {
      setIsGlobeReset && setIsGlobeReset(false);
      setActiveGlobeDataset && setActiveGlobeDataset(datasetId);
      try { selectDatasetFromProvider && selectDatasetFromProvider(datasetId); } catch {}
      setShowGlobe && setShowGlobe(true);
      setShowGraph && setShowGraph(false);
      setActiveDataset && setActiveDataset(null);
    } else {
      setActiveDataset && setActiveDataset(ds);
      setShowGraph && setShowGraph(true);
      setShowGlobe && setShowGlobe(true);
      // Set activeGlobeDataset so year slider appears even in graph mode
      setActiveGlobeDataset && setActiveGlobeDataset(datasetId);
      // Load data via provider so globe can show colors in background
      try { selectDatasetFromProvider && selectDatasetFromProvider(datasetId); } catch {}
    }
  }, [ctxAvailable, datasetSearchResults, selectDatasetFromProvider, setSelectedDataset, setIsGlobeReset, setActiveGlobeDataset, setShowGlobe, setShowGraph, setActiveDataset]);

  const handleResetGlobe = useCallback(() => {
    setActiveGlobeDataset && setActiveGlobeDataset(null);
    setPopulationData && setPopulationData([]);
    setLifeExpData && setLifeExpData([]);
    setGdpData && setGdpData([]);
    setSelectedRegion && setSelectedRegion('World');
    setSelectedPopulationYear && setSelectedPopulationYear(null);
    setSelectedLifeExpYear && setSelectedLifeExpYear(null);
    setSelectedGdpYear && setSelectedGdpYear(null);
    setIsGlobeReset && setIsGlobeReset(true);
    setGlobeDataError && setGlobeDataError(null);
    try {
      const popControls = document.querySelector('#population-controls');
      const lifeControls = document.querySelector('#life-expectancy-controls');
      const gdpControls = document.querySelector('#gdp-controls');
      if (popControls) popControls.style.display = 'none';
      if (lifeControls) lifeControls.style.display = 'none';
      if (gdpControls) gdpControls.style.display = 'none';
    } catch {}
  }, [setActiveGlobeDataset, setPopulationData, setLifeExpData, setGdpData, setSelectedRegion, setSelectedPopulationYear, setSelectedLifeExpYear, setSelectedGdpYear, setIsGlobeReset, setGlobeDataError]);

  return { handleDatasetSelect, handleResetGlobe };
}



