import { Step } from '../constants.js';
import type { Snapshot } from '../types.js';

/**
 * С какого экрана начинать. Мастер нужен, только если без него не обойтись: корневой сертификат не
 * установлен или не покрывает домены из масок. Системный прокси в проверке не участвует: при выходе
 * приложение возвращает прежние настройки, а при запуске PAC включает сам свитч на рабочем экране.
 */
export const startStep = (snap: Snapshot): Step =>
  snap.cert.trusted && snap.cert.constraints.uncovered.length === 0 ? Step.Work : Step.Cert;
