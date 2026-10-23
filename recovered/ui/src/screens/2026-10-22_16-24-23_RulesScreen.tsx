/** Шаг правил — папки с кодом, модули и маска сайта. */
import type { MaskOption, Snapshot, SiteMask } from '../types.js';
import { MasksPanel, ModulesPanel, RootsPanel } from '../components/index.js';
import { Button } from '../ui/Button.js';

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
    <div className="flex flex-col gap-3">
      <RootsPanel roots={snap.roots} onChanged={onChanged} />
      <ModulesPanel modules={snap.modules} roots={snap.roots} onChanged={onChanged} />
      <MasksPanel mask={mask} onChange={onMaskChange} files={files} onFilesChange={onFilesChange} />
    </div>
  );

  if (embedded) return panels;

  return (
    <div className="flex h-full flex-col justify-between gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-ink">Папки и сайт</h1>
        {panels}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="primary" onClick={onDone}>
          Готово
        </Button>
      </div>
    </div>
  );
};
