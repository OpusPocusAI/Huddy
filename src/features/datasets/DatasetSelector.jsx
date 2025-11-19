import React from 'react';
import { useDatasets } from './DatasetContext';

export default function DatasetSelector({ onSelectGlobe, onSelectGraph }) {
  const { available, loadingAvailable, selectedId, select } = useDatasets() || {};

  return (
    <div className="p-4 bg-gray-900/40 rounded-xl border border-neon-blue/20">
      <h3 className="text-sm font-bold text-neon-blue mb-2">Available Datasets</h3>
      {loadingAvailable ? (
        <div className="text-neon-blue">Loading datasets...</div>
      ) : (
        <>
          <select
            className="w-full p-2 rounded bg-gray-800 text-white"
            value={selectedId || ''}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">Select a dataset</option>
            {(available || []).map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.title}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 p-2 bg-neon-blue rounded text-black hover:bg-neon-blue/80 transition-colors"
              onClick={() => {
                console.log('📈 Show Graph clicked from DatasetSelector:', selectedId);
                selectedId && onSelectGraph?.(selectedId);
              }}
              disabled={!selectedId}
            >
              Show Graph
            </button>
            <button
              className="flex-1 p-2 bg-neon-purple text-black rounded hover:bg-neon-purple/80 transition-colors"
              onClick={() => {
                console.log('🌍 Show on Globe clicked from DatasetSelector:', selectedId);
                selectedId && onSelectGlobe?.(selectedId);
              }}
              disabled={!selectedId}
            >
              Show on Globe
            </button>
          </div>
        </>
      )}
    </div>
  );
}


