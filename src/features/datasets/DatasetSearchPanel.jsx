import React from 'react';

export default function DatasetSearchPanel({
  mode,
  datasetQuery,
  setDatasetQuery,
  onSearch,
  datasetSearchResults,
  countryList,
  onProcessDataset,
  onSelectRegion,
}) {
  if (mode === 'ideologram') return null;
  return (
    <div className="p-4 bg-gray-900/40 rounded-xl border border-neon-blue/20 mb-4">
      <h3 className="text-sm font-bold text-neon-blue mb-2">Dataset Search</h3>
      <div className="flex mb-2">
        <input
          className="flex-1 p-2 rounded bg-gray-800 text-white"
          placeholder="Type category like GDP or Country/Region"
          value={datasetQuery}
          onChange={(e) => setDatasetQuery(e.target.value)}
        />
        <button onClick={onSearch} className="ml-2 px-3 py-1 bg-neon-blue rounded text-black">Go</button>
      </div>
      {datasetSearchResults.length > 0 ? (
        <ul className="max-h-32 overflow-auto text-sm text-white">
          {datasetSearchResults.map((ind) => (
            <li key={ind.id} className="flex justify-between items-center py-1 border-b border-gray-700">
              <span className="flex-1">{ind.name}</span>
              <div className="flex gap-1">
                <button
                  className="px-2 py-1 bg-neon-blue rounded text-black text-xs"
                  onClick={() => onProcessDataset(ind.id, 'globe')}
                  title="Show on 3D Globe"
                >
                  Globe
                </button>
                <button
                  className="px-2 py-1 bg-neon-purple rounded text-black text-xs"
                  onClick={() => onProcessDataset(ind.id, 'graph')}
                  title="Show as Graph"
                >
                  Graph
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : countryList.length > 0 ? (
        <ul className="max-h-32 overflow-auto text-sm text-white">
          {countryList.map((c) => (
            <li key={c.id} className="flex justify-between items-center py-1 border-b border-gray-700">
              <span>{c.name}</span>
              <button className="ml-2 px-2 py-1 bg-neon-purple rounded text-black text-xs" onClick={() => onSelectRegion(c.id)}>
                Select
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}


