/** Шаг 3: правила — папки с кодом, модули и маска сайта. */
import type { MaskOption, Snapshot, SiteMask } from '../types.js';
import { MasksPanel, ModulesPanel, RootsPanel } from '../components/index.js';

export type RulesScreenProps = {
  snap: Snapshot;
  mask: SiteMask;
  files: MaskOption[];
  onChanged: () => void;
  onMaskChange: (next: SiteMask) => void;
  onFilesChange: (next: MaskOption[]) => void;
  onDone: () => void;
  /** внутри спойлера на рабочем экране: без заголовка и кнопки «Готово» */
  embedded?: boolean;
};

export const RulesScreen = ({
  snap,
  mask,
  files,
  onChanged,
  onMaskChange,
  onFilesChange,
  onDone,
  embedded,
}: RulesScreenProps) => {
  const panels = (
    <>
      <RootsPanel roots={snap.roots} onChanged={onChanged} />
      <ModulesPanel modules={snap.modules} roots={snap.roots} onChanged={onChanged} />
      <MasksPanel mask={mask} onChange={onMaskChange} files={files} onFilesChange={onFilesChange} />
    </>
  );

  if (embedded) return panels;

  return (
    <div className="card">
      <div className="content">
        <h1>Папки и сайт</h1>
        {panels}
      </div>
      <div className="footer">
        <div className="actions right">
          <button className="btn primary" onClick={onDone}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
