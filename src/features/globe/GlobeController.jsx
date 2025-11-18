import React, { useCallback, useMemo, useState } from 'react';
import Globe from '../../components/Globe';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import eventBus from '../../shared/events/eventBus';
import { Events } from '../../shared/events/contracts';

function normalizeCountryName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

export default function GlobeController({
  countries,
  warRoomMode = false,
  deepStateFeatures = [],
  globeMaterial,
  showGraticules = false,
  showAtmosphere = true,
  onGlobeReady,
  showTexture = true,
  fpsLimit = 60,
  rotationEnabled = false,
  width = 800,
  height = 800,

  // Dataset context
  activeGlobeDataset,
  populationData,
  lifeExpData,
  gdpData,
  selectedPopulationYear,
  selectedLifeExpYear,
  selectedGdpYear,

  // Generic provider-driven inputs (preferred if provided)
  genericSeries,
  genericSelectedYear
}) {
  const [hovered, setHovered] = useState(null);

  const polygonsData = useMemo(() => (
    warRoomMode
      ? deepStateFeatures
      : (countries?.features || []).filter((feat) => feat.properties?.ISO_A2 !== 'AQ')
  ), [warRoomMode, deepStateFeatures, countries]);

  const emitTooltip = useCallback((country, evt) => {
    if (!country || !evt) { eventBus.emit(Events.UiTooltipHide); return; }
    const name = country?.properties?.ADMIN || 'Unknown';
    const lower = normalizeCountryName(name);

    // Prefer generic series if provided
    const series = Array.isArray(genericSeries) && genericSeries.length ? genericSeries : null;

    const lifeExpLine = activeGlobeDataset === 'life-expectancy' && (lifeExpData || series)
      ? (() => {
          const year = genericSelectedYear ?? selectedLifeExpYear;
          const list = series || lifeExpData || [];
          const rec = list.find(item => normalizeCountryName(item.entity) === lower && item.year === year)
                 || list.find(item => normalizeCountryName(item.entity) === lower);
          const value = rec?.value != null ? Number(rec.value).toFixed(1) : null;
          return value ? (<div className="text-sm text-gray-300">Life Expectancy: {value} years</div>) : null;
        })()
      : null;

    const populationLine = activeGlobeDataset === 'population' && (populationData || series)
      ? (() => {
          const year = genericSelectedYear ?? selectedPopulationYear;
          const list = series || populationData || [];
          const rec = list.find(item => normalizeCountryName(item.entity) === lower && item.year === year);
          const value = rec?.value != null ? new Intl.NumberFormat().format(rec.value) : null;
          return value ? (<div className="text-sm text-gray-300">Population: {value}</div>) : null;
        })()
      : null;

    const gdpLine = activeGlobeDataset === 'NY.GDP.PCAP.PP.KD' && (gdpData || series)
      ? (() => {
          const year = genericSelectedYear ?? selectedGdpYear;
          const list = series || gdpData || [];
          let rec = list.find(item => item.iso === country?.properties?.ISO_A3 && item.year === year);
          if (!rec) rec = list.find(item => normalizeCountryName(item.entity) === lower && item.year === year);
          const value = rec?.value != null ? new Intl.NumberFormat().format(rec.value) : null;
          return value ? (<div className="text-sm text-gray-300">GDP per Capita: {value}</div>) : null;
        })()
      : null;

    // Fallback: show generic dataset value if no specific dataset matched
    const genericLine = !lifeExpLine && !populationLine && !gdpLine && series && genericSelectedYear
      ? (() => {
          const year = genericSelectedYear;
          let rec = series.find(item => item.iso === country?.properties?.ISO_A3 && item.year === year);
          if (!rec) rec = series.find(item => normalizeCountryName(item.entity) === lower && item.year === year);
          const value = rec?.value != null ? new Intl.NumberFormat().format(rec.value) : null;
          return value ? (<div className="text-sm text-gray-300">Value: {value}</div>) : null;
        })()
      : null;

    const region = country?.properties?.REGION_WB || country?.properties?.CONTINENT || 'N/A';

    const content = (
      <div>
        <div className="font-bold text-lg">{name}</div>
        {lifeExpLine}
        {populationLine}
        {gdpLine}
        {genericLine}
        <div className="text-xs text-gray-400 mt-1">Region: {region}</div>
      </div>
    );

    eventBus.emit(Events.UiTooltipShow, { x: evt.clientX, y: evt.clientY, content });
  }, [activeGlobeDataset, lifeExpData, populationData, gdpData, selectedGdpYear, selectedLifeExpYear, selectedPopulationYear, genericSeries, genericSelectedYear]);

  const onHover = useCallback((country, evt) => {
    setHovered(country || null);
    // Only emit when both target and coordinates exist to avoid 0,0 flashes
    if (country && evt && typeof evt.clientX === 'number' && typeof evt.clientY === 'number') {
      emitTooltip(country, evt);
    } else {
      eventBus.emit(Events.UiTooltipHide);
    }
  }, [emitTooltip]);

  // Hide tooltip on unmount to avoid lingering overlay when switching views
  React.useEffect(() => () => { try { eventBus.emit(Events.UiTooltipHide); } catch {} }, []);

  const polygonCapColor = useCallback((d) => {
    if (warRoomMode) return 'rgba(255,255,0,0.2)';
    const name = normalizeCountryName(d?.properties?.ADMIN);
    const series = Array.isArray(genericSeries) && genericSeries.length ? genericSeries : null;
    if (activeGlobeDataset === 'life-expectancy' && (lifeExpData || series) && (genericSelectedYear || selectedLifeExpYear)) {
      const year = genericSelectedYear ?? selectedLifeExpYear;
      const list = series || lifeExpData || [];
      const rec = list.find(item => normalizeCountryName(item.entity) === name && item.year === year);
      if (rec) {
        const yearData = (list || []).filter(item => item.year === year);
        const max = Math.max(...yearData.map(item => item.value || 0));
        const t = max > 0 ? (rec.value || 0) / max : 0;
        return interpolateYlOrRd(t);
      }
    }
    if (activeGlobeDataset === 'population' && (populationData || series) && (genericSelectedYear || selectedPopulationYear)) {
      const year = genericSelectedYear ?? selectedPopulationYear;
      const list = series || populationData || [];
      const rec = list.find(item => normalizeCountryName(item.entity) === name && item.year === year);
      if (rec) {
        const yearData = (list || []).filter(item => item.year === year);
        const max = Math.max(...yearData.map(item => item.value || 0));
        const t = max > 0 ? (rec.value || 0) / max : 0;
        return interpolateYlOrRd(t);
      }
    }
    if (activeGlobeDataset === 'NY.GDP.PCAP.PP.KD' && (gdpData || series) && (genericSelectedYear || selectedGdpYear)) {
      const year = genericSelectedYear ?? selectedGdpYear;
      const list = series || gdpData || [];
      let rec = list.find(item => item.iso === d?.properties?.ISO_A3 && item.year === year);
      if (!rec) rec = list.find(item => normalizeCountryName(item.entity) === name && item.year === year);
      if (rec) {
        const yearData = (list || []).filter(item => item.year === year);
        const max = Math.max(...yearData.map(item => item.value || 0));
        const t = max > 0 ? (rec.value || 0) / max : 0;
        return interpolateYlOrRd(t);
      }
    }
    // Fallback: use genericSeries for any other dataset (e.g., World Bank indicators)
    if (series && genericSelectedYear) {
      const year = genericSelectedYear;
      // Try matching by ISO code first, then by entity name
      let rec = series.find(item => item.iso === d?.properties?.ISO_A3 && item.year === year);
      if (!rec) rec = series.find(item => normalizeCountryName(item.entity) === name && item.year === year);
      if (rec) {
        const yearData = series.filter(item => item.year === year);
        const max = Math.max(...yearData.map(item => item.value || 0));
        const t = max > 0 ? (rec.value || 0) / max : 0;
        return interpolateYlOrRd(t);
      }
    }
    return 'rgba(200,200,200,0.01)';
  }, [warRoomMode, activeGlobeDataset, lifeExpData, populationData, gdpData, selectedLifeExpYear, selectedPopulationYear, selectedGdpYear, genericSeries, genericSelectedYear]);

  const polygonSideColor = useCallback((d) => (
    d === hovered ? 'rgba(57,255,20,0.15)' : 'rgba(150,150,150,0.01)'
  ), [hovered]);

  const polygonStrokeColor = useCallback((d) => (
    d === hovered ? 'rgba(57,255,20,0.6)' : 'rgba(57,255,20,0.3)'
  ), [hovered]);

  const polygonAltitude = useCallback((d) => (
    d === hovered ? 0.15 : 0.1
  ), [hovered]);

  return (
    <Globe
      data-test="globe-container"
      key={`globe-ctrl-${warRoomMode}-${polygonsData.length}-${showTexture}-${fpsLimit}-${activeGlobeDataset}-${selectedPopulationYear || ''}-${selectedLifeExpYear || ''}-${selectedGdpYear || ''}`}
      width={width}
      height={height}
      globeMaterial={globeMaterial}
      backgroundColor="rgba(0,0,0,0)"
      fpsLimit={fpsLimit}
      rotationEnabled={rotationEnabled}
      polygonsData={polygonsData}
      polygonAltitude={polygonAltitude}
      polygonCapColor={polygonCapColor}
      polygonSideColor={polygonSideColor}
      polygonStrokeColor={polygonStrokeColor}
      onContextMenu={(e) => e.preventDefault()}
      onPolygonHover={onHover}
      showGraticules={showGraticules}
      showAtmosphere={showAtmosphere}
      onGlobeReady={onGlobeReady}
      showTexture={showTexture}
    />
  );
}


