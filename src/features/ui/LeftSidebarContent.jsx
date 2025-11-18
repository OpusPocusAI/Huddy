import React from 'react';
import SidebarFilesPanel from '../ideologram/SidebarFilesPanel';
import SavedScoresPanel from '../ideologram/SavedScoresPanel';
import DatasetSearchPanel from '../datasets/DatasetSearchPanel';
import DominantSpeciesCard from './DominantSpeciesCard';
import MiniChat from './MiniChat';
import SystemStatsCard from './SystemStatsCard';
import DatasetYearControls from '../datasets/DatasetYearControls';
import JsonExplorerPanel from './JsonExplorerPanel';

export default function LeftSidebarContent(props) {
  const {
    mode,
    renderDatasetSelector,
    datasetQuery,
    setDatasetQuery,
    handleSearch,
    datasetSearchResults,
    countryList,
    setSelectedRegion,
    user,
    // Ideologram (left sidebar)
    fileTree,
    fileOpen,
    filePreviews,
    onFileClick,
    onRefreshFiles,
    ideoScores,
    setIdeoScores,
    activeGlobeDataset,
    populationYears,
    selectedPopulationYear,
    setSelectedPopulationYear,
    lifeExpYears,
    selectedLifeExpYear,
    setSelectedLifeExpYear,
    gdpYears,
    selectedGdpYear,
    setSelectedGdpYear,
    civAge,
    setCivAge,
    isLoggedIn,
    warRoomMode,
    setWarRoomMode,
    setShowFinancial,
    leftSidebarContentRef,
    currentConversation,
    handleChatSend,
    setMode,
    handleProcessDataset,
  } = props;

  return (
    <div ref={leftSidebarContentRef} className="flex-1 overflow-y-auto relative flex flex-col">
      {mode !== 'ideologram' && renderDatasetSelector()}
      {mode !== 'ideologram' && (
        <DatasetSearchPanel
          mode={mode}
          datasetQuery={datasetQuery}
          setDatasetQuery={setDatasetQuery}
          onSearch={handleSearch}
          datasetSearchResults={datasetSearchResults}
          countryList={countryList}
          onProcessDataset={(id, displayType) => props.handleProcessDataset(id, displayType)}
          onSelectRegion={(id) => setSelectedRegion(id)}
        />
      )}

      {mode === 'ideologram' && (
        <>
          <SidebarFilesPanel
            user={user}
            onRefresh={onRefreshFiles}
            fileTree={fileTree}
            fileOpen={fileOpen}
            filePreviews={filePreviews}
            onFileClick={onFileClick}
          />
          <SavedScoresPanel scores={ideoScores} setScores={setIdeoScores} />
        </>
      )}

      {mode === 'jsonfs' && (
        <JsonExplorerPanel />
      )}

      <DatasetYearControls
        activeGlobeDataset={activeGlobeDataset}
        populationYears={populationYears}
        selectedPopulationYear={selectedPopulationYear}
        setSelectedPopulationYear={setSelectedPopulationYear}
        lifeExpYears={lifeExpYears}
        selectedLifeExpYear={selectedLifeExpYear}
        setSelectedLifeExpYear={setSelectedLifeExpYear}
        gdpYears={gdpYears}
        selectedGdpYear={selectedGdpYear}
        setSelectedGdpYear={setSelectedGdpYear}
      />

      <DominantSpeciesCard species="Homo Sapiens" />

      <SystemStatsCard civAge={civAge} setCivAge={setCivAge} />

      {isLoggedIn && (
        <button onClick={() => setWarRoomMode(v => !v)} className="w-full mt-4 p-2 bg-red-600 text-white rounded hover:bg-red-500">
          {warRoomMode ? 'Exit War Room' : 'War Room'}
        </button>
      )}
      {isLoggedIn && (
        <button onClick={() => { setShowFinancial(true); }} className="w-full mt-2 p-2 bg-neon-blue text-black rounded hover:bg-neon-blue/80">
          Financial Mode
        </button>
      )}

      <MiniChat
        parentRef={leftSidebarContentRef}
        currentConversation={currentConversation}
        onSend={handleChatSend}
        onOpenChat={() => setMode('chat')}
        mode={mode}
      />
    </div>
  );
}


