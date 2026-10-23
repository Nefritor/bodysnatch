interface IStepsData {
  key: Step;
  label: string;
  size: {
    w: number;
    h: number;
  };
}

export enum Step {
  Cert = 'cert',
  Proxy = 'proxy',
  Rules = 'rules',
  Work = 'work',
}

export const STEPS: IStepsData[] = [
  { key: Step.Cert, label: 'Сертификат', size: { w: 600, h: 370 } },
  { key: Step.Proxy, label: 'Прокси', size: { w: 600, h: 270 } },
  { key: Step.Rules, label: 'Правила', size: { w: 600, h: 690 } },
  { key: Step.Work, label: 'Работа', size: { w: 600, h: 235 } },
];
