/** Мелкие текстовые утилиты интерфейса. */

/** Нормализация пути для сравнения: без хвостовых слэшей, в нижнем регистре. */
export const norm = (p: string) =>
  String(p || '')
    .replace(/[\\/]+$/, '')
    .toLowerCase();

/** Русские формы множественного числа: plural(1,'модуль','модуля','модулей'). */
export const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};
