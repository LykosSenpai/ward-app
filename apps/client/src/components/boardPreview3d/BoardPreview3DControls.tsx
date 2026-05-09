import { CAMERA_PRESETS } from "../boardPreview3dLayout";

type BoardPreview3DControlsProps = {
  tiltDegrees: number;
  setTiltDegrees: (value: number) => void;
  zoomScale: number;
  setZoomScale: (value: number) => void;
  heightScale: number;
  setHeightScale: (value: number) => void;
  boardScaleX: number;
  setBoardScaleX: (value: number) => void;
  boardScaleZ: number;
  setBoardScaleZ: (value: number) => void;
  boardOffsetX: number;
  setBoardOffsetX: (value: number) => void;
  boardOffsetZ: number;
  setBoardOffsetZ: (value: number) => void;
  cameraPanX: number;
  setCameraPanX: (value: number) => void;
  cameraPanY: number;
  setCameraPanY: (value: number) => void;
  ownerFilter: "all" | "player_1" | "player_2";
  setOwnerFilter: (value: "all" | "player_1" | "player_2") => void;
  showDebugPanel: boolean;
  setShowDebugPanel: (value: boolean) => void;
  showAnchors: boolean;
  setShowAnchors: (value: boolean) => void;
  adminView: boolean;
  showDiagnostics: boolean;
  setShowDiagnostics: (value: boolean) => void;
  integrationMode: boolean;
  setIntegrationMode: (value: boolean) => void;
  onResetAll: () => void;
};

export function BoardPreview3DControls(props: BoardPreview3DControlsProps) {
  const applyZoomScale = (raw: number) => {
    const normalized = Math.max(0.8, Math.min(1.25, Math.round(raw * 20) / 20));
    props.setZoomScale(normalized);
  };

  const applyPreset = (preset: keyof typeof CAMERA_PRESETS) => {
    const settings = CAMERA_PRESETS[preset];
    props.setTiltDegrees(settings.tilt);
    applyZoomScale(settings.zoom);

    props.setHeightScale(settings.height);
  };

  return (
    <>
      <div className="board-preview-3d__presets" aria-label="3D camera presets">
        <button type="button" onClick={() => applyPreset("tactical")}>Tactical</button>
        <button type="button" onClick={() => applyPreset("neutral")}>Neutral</button>
        <button type="button" onClick={() => applyPreset("cinematic")}>Cinematic</button>
        <button type="button" className="ghost" onClick={() => applyPreset("neutral")}>Reset</button>
        <button type="button" className="ghost" disabled={props.integrationMode} onClick={() => props.setShowDebugPanel(!props.showDebugPanel)}>{props.showDebugPanel ? "Hide Debug" : "Show Debug"}</button>
        <button type="button" className="ghost" onClick={() => props.setShowAnchors(!props.showAnchors)}>{props.showAnchors ? "Hide Anchors" : "Show Anchors"}</button>
        <button type="button" className="ghost" disabled={props.integrationMode} onClick={props.onResetAll}>Reset All</button>
        <select value={props.ownerFilter} onChange={(event) => props.setOwnerFilter(event.target.value as "all" | "player_1" | "player_2")}>
          <option value="all">All Pieces</option>
          <option value="player_1">Player 1 Pieces</option>
          <option value="player_2">Player 2 Pieces</option>
        </select>
        {props.adminView ? (
          <button type="button" className="ghost" onClick={() => props.setShowDiagnostics(!props.showDiagnostics)}>{props.showDiagnostics ? "Diagnostics Off" : "Diagnostics On"}</button>
        ) : null}
        <button type="button" className="ghost" onClick={() => props.setIntegrationMode(!props.integrationMode)}>
          {props.integrationMode ? "Prototype Mode" : "Integration Mode"}
        </button>
      </div>

      <div className="board-preview-3d__controls" aria-label="3D camera controls">
        <label>
          Tilt
          <input type="range" min={35} max={72} value={props.tiltDegrees} onChange={(event) => props.setTiltDegrees(Number(event.target.value))} />
          <span>{props.tiltDegrees}°</span>
        </label>
        <label>
          Zoom
          <input type="range" min={80} max={125} step={5} value={Math.round(props.zoomScale * 100)} onChange={(event) => applyZoomScale(Number(event.target.value) / 100)} />

          <span>{Math.round(props.zoomScale * 100)}%</span>
        </label>
        <label>
          Height
          <input type="range" min={60} max={180} value={Math.round(props.heightScale * 100)} onChange={(event) => props.setHeightScale(Number(event.target.value) / 100)} />
          <span>{Math.round(props.heightScale * 100)}%</span>
        </label>
        <label>
          Width
          <input type="range" min={70} max={140} value={Math.round(props.boardScaleX * 100)} onChange={(event) => props.setBoardScaleX(Number(event.target.value) / 100)} />
          <span>{Math.round(props.boardScaleX * 100)}%</span>
        </label>
        <label>
          Depth
          <input type="range" min={70} max={140} value={Math.round(props.boardScaleZ * 100)} onChange={(event) => props.setBoardScaleZ(Number(event.target.value) / 100)} />
          <span>{Math.round(props.boardScaleZ * 100)}%</span>
        </label>
        <label>
          Shift X
          <input type="range" min={-20} max={20} value={Math.round(props.boardOffsetX)} onChange={(event) => props.setBoardOffsetX(Number(event.target.value))} />
          <span>{Math.round(props.boardOffsetX)}%</span>
        </label>
        <label>
          Shift Z
          <input type="range" min={-20} max={20} value={Math.round(props.boardOffsetZ)} onChange={(event) => props.setBoardOffsetZ(Number(event.target.value))} />
          <span>{Math.round(props.boardOffsetZ)}%</span>
        </label>

        <label>
          Pan X
          <input type="range" min={-25} max={25} value={Math.round(props.cameraPanX)} onChange={(event) => props.setCameraPanX(Number(event.target.value))} />

          <span>{Math.round(props.cameraPanX)}%</span>
        </label>
        <label>
          Pan Y
          <input type="range" min={-25} max={25} value={Math.round(props.cameraPanY)} onChange={(event) => props.setCameraPanY(Number(event.target.value))} />

          <span>{Math.round(props.cameraPanY)}%</span>
        </label>

      </div>
      <p className="board-preview-3d__status">
        Shortcuts: Arrow keys nudge selected slot · R resets editor {props.integrationMode ? "(disabled in Integration Mode)" : ""}

      </p>
    </>
  );
}
