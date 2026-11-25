/**
 * Тесты шапки: ссылка на свой профиль из ника и плашки баланса.
 * Ядро чистое — без DOM и сети; видимость и адрес решаются здесь,
 * компонент только накладывает результат на разметку.
 */
import { describe, expect, it } from 'vitest';
import { balancePlate, nickLink } from './header';

const UID = '5b1f0c2e-9d3a-4f7b-8c1d-2e3f4a5b6c7d';
const HREF = `/profile/?uid=${UID}`;

describe('nickLink', () => {
  it('залогиненному ник — ссылка в свой профиль', () => {
    expect(nickLink({ login: 'ShidouQuE', uid: UID })).toEqual({
      signedIn: true,
      text: '@ShidouQuE',
      href: HREF,
    });
  });

  it('гостю ник не показываем и ссылки не даём', () => {
    expect(nickLink({ login: null, uid: null })).toEqual({
      signedIn: false,
      text: '',
      href: null,
    });
  });

  it('ник без uid ссылкой не становится', () => {
    expect(nickLink({ login: 'ShidouQuE', uid: null })).toEqual({
      signedIn: true,
      text: '@ShidouQuE',
      href: null,
    });
  });

  it('пустой логин — гость: одинокого `@` на экране нет', () => {
    expect(nickLink({ login: '', uid: UID })).toEqual({
      signedIn: false,
      text: '',
      href: null,
    });
    expect(nickLink({ login: '  ', uid: UID })).toEqual({
      signedIn: false,
      text: '',
      href: null,
    });
  });

  it('чужой мусор вместо uid не превращает ник в ссылку', () => {
    expect(nickLink({ login: 'ShidouQuE', uid: 'Биржа' })).toEqual({
      signedIn: true,
      text: '@ShidouQuE',
      href: null,
    });
  });
});

describe('balancePlate', () => {
  it('залогиненному плашка ведёт в свой профиль', () => {
    expect(balancePlate({ uid: UID, balanceKnown: true, balance: 4320 })).toEqual({
      visible: true,
      value: '4320',
      href: HREF,
    });
  });

  it('гостю плашки нет — и адреса профиля тоже', () => {
    expect(balancePlate({ uid: null, balanceKnown: true, balance: 4320 })).toEqual({
      visible: false,
      value: '',
      href: null,
    });
  });

  it('без ответа по балансу не мигаем прочерком, но адрес уже готов', () => {
    expect(balancePlate({ uid: UID, balanceKnown: false, balance: null })).toEqual({
      visible: false,
      value: '',
      href: HREF,
    });
  });

  it('счёт есть, суммы нет — прочерк, деньги целы', () => {
    expect(balancePlate({ uid: UID, balanceKnown: true, balance: null })).toEqual({
      visible: true,
      value: '—',
      href: HREF,
    });
  });
});
