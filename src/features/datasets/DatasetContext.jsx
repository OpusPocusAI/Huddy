import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { datasetsApi } from './api';
import eventBus from '../../shared/events/eventBus';
import { Events } from '../../shared/events/contracts';

const DatasetContext = createContext(null);

export function DatasetProvider({ children }) {
  const [available, setAvailable] = useState([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [series, setSeries] = useState([]);
  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const refreshAvailable = useCallback(async () => {
    setLoadingAvailable(true);
    try {
      const list = await datasetsApi.getAvailable();
      setAvailable(list || []);
    } catch (e) {
      setAvailable([]);
    } finally {
      setLoadingAvailable(false);
    }
  }, []);

  const select = useCallback(async (id) => {
    setSelectedId(id);
    eventBus.emit(Events.DatasetSelected, { id });
    try {
      setIsLoading(true);
      const data = await datasetsApi.load(id);
      const normalized = Array.isArray(data) ? data.map(d => ({
        year: Number(d.year),
        entity: d.entity,
        value: Number(d.value),
        iso: d.iso
      })).filter(d => !isNaN(d.year) && !isNaN(d.value)) : [];
      setSeries(normalized);
      const ys = Array.from(new Set(normalized.map(d => d.year))).sort((a,b)=>a-b);
      setYears(ys);
      setSelectedYear(ys.length ? ys[ys.length - 1] : null);
      eventBus.emit(Events.DatasetLoaded, { id, series: normalized });
    } catch (e) {
      setError(e?.message || 'Failed to load dataset');
      setSeries([]);
      setYears([]);
      setSelectedYear(null);
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { refreshAvailable(); }, [refreshAvailable]);

  const value = useMemo(() => ({
    available,
    loadingAvailable,
    selectedId,
    series,
    years,
    selectedYear,
    error,
    isLoading,
    refreshAvailable,
    select,
    setSelectedYear
  }), [available, loadingAvailable, selectedId, series, years, selectedYear, error, refreshAvailable, select]);

  return (
    <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>
  );
}

export const useDatasets = () => useContext(DatasetContext);


