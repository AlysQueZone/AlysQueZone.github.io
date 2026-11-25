/**
 * Тесты чистого ядра профиля: ссылка, разбор uid, статы и форматы.
 * Без DOM и сети; форма строки `public_profile` проверяется как сеть —
 * битые значения отбрасываются, а не чинятся.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanLogin,
  formatProfileDate,
  formatProfileNumber,
  parseProfileUid,
  profileHref,
  profileStats,
  profileUidFromQuery,
  type ProfileRow,
} from './profile';

const UID = '5b1f0c2e-9d3a-4f7b-8c1d-2e3f4a5b6c7d';
const AVATAR =
  'https://static-cdn.jtvnw.net/jtv_user_pictures/5b1f0c2e-9d3a-4f7b-8c1d-profile_image-300x300.png';

function row(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: UID,
    login: 'ShidouQuE',
    avatar_url: AVATAR,
    balance: 4320,
    created_at: '2026-09-12T10:00:00+00:00',
    capital: 7860,
    lots_count: 6,
    ...overrides,
  };
}

describe('profileHref', () => {
  it('ведёт на статическую страницу профиля по uid', () => {
    expect(profileHref(UID)).toBe(`/profile/?uid=${UID}`);
  });

  it('без uid ссылки нет: «Биржа» и свободный лот остаются текстом', () => {
    expect(profileHref(null)).toBeNull();
    expect(profileHref(undefined)).toBeNull();
    expect(profileHref('')).toBeNull();
  });

  it('не uuid — не ссылка: «Биржа», логин и мусор не станут адресом профиля', () => {
    for (const bad of ['Биржа', 'abc', '@ShidouQuE', 'a b&c', '5b1f0c2e-9d3a-4f7b-8c1d']) {
      expect(profileHref(bad), bad).toBeNull();
    }
  });

  it('uid приводится к канону: регистр и пробелы нормализуются', () => {
    expect(profileHref(` ${UID.toUpperCase()} `)).toBe(`/profile/?uid=${UID}`);
  });
});

describe('cleanLogin', () => {
  it('убирает пробелы и ведущие `@` — одна уборка на подпись и заголовки', () => {
    expect(cleanLogin('  @@ShidouQuE ')).toBe('ShidouQuE');
    expect(cleanLogin('avrora_666')).toBe('avrora_666');
  });

  it('нет логина — пустая строка, а не «undefined»', () => {
    expect(cleanLogin(null)).toBe('');
    expect(cleanLogin(undefined)).toBe('');
    expect(cleanLogin(42)).toBe('');
    expect(cleanLogin(' @ ')).toBe('');
  });
});

describe('parseProfileUid', () => {
  it('принимает канонический uuid и нормализует регистр', () => {
    expect(parseProfileUid(UID)).toBe(UID);
    expect(parseProfileUid(` ${UID.toUpperCase()} `)).toBe(UID);
  });

  it('битый uid отсекается на клиенте — Postgres не должен получить cast', () => {
    for (const bad of [
      '',
      '   ',
      'abc',
      '42',
      '5b1f0c2e9d3a4f7b8c1d2e3f4a5b6c7d',
      '5b1f0c2e-9d3a-4f7b-8c1d-2e3f4a5b6c7',
      '5b1f0c2e-9d3a-4f7b-8c1d-2e3f4a5b6c7d0',
      'zzzzzzzz-9d3a-4f7b-8c1d-2e3f4a5b6c7d',
      "5b1f0c2e-9d3a-4f7b-8c1d-2e3f4a5b6c7d' or 1=1",
    ]) {
      expect(parseProfileUid(bad)).toBeNull();
    }
    expect(parseProfileUid(null)).toBeNull();
  });
});

describe('profileUidFromQuery', () => {
  it('читает uid из query-строки', () => {
    expect(profileUidFromQuery(`?uid=${UID}&x=1`)).toBe(UID);
    expect(profileUidFromQuery('uid=' + UID)).toBe(UID);
  });

  it('нет uid или он битый — разбор возвращает null', () => {
    expect(profileUidFromQuery('')).toBeNull();
    expect(profileUidFromQuery('?')).toBeNull();
    expect(profileUidFromQuery('?uid=')).toBeNull();
    expect(profileUidFromQuery('?uid=abc')).toBeNull();
  });
});

describe('profileStats', () => {
  it('строка public_profile — точные статы паспорта', () => {
    expect(profileStats(row())).toEqual({
      uid: UID,
      login: 'ShidouQuE',
      caption: '@ShidouQuE',
      initials: 'SQ',
      avatarUrl: AVATAR,
      joinedAt: '2026-09-12T10:00:00+00:00',
      balance: 4320,
      capital: 7860,
      lotsCount: 6,
    });
  });

  it('аватар — только https-адрес Twitch, остальное остаётся инициалам', () => {
    expect(profileStats(row())?.avatarUrl).toBe(AVATAR);
    expect(profileStats(row({ avatar_url: `  ${AVATAR}  ` }))?.avatarUrl).toBe(AVATAR);
  });

  it('нет аватара или он пустой — null, а не «undefined»', () => {
    expect(profileStats(row({ avatar_url: null }))?.avatarUrl).toBeNull();
    expect(profileStats(row({ avatar_url: undefined }))?.avatarUrl).toBeNull();
    expect(profileStats(row({ avatar_url: '' }))?.avatarUrl).toBeNull();
    expect(profileStats(row({ avatar_url: '   ' }))?.avatarUrl).toBeNull();
    expect(profileStats(row({ avatar_url: 42 }))?.avatarUrl).toBeNull();
  });

  it('http, javascript и мусор — null: картинка не грузится из небезопасного источника', () => {
    for (const bad of [
      'http://static-cdn.jtvnw.net/avatar.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//static-cdn.jtvnw.net/avatar.png',
      'static-cdn.jtvnw.net/avatar.png',
      'не ссылка',
      'https://',
    ]) {
      expect(profileStats(row({ avatar_url: bad }))?.avatarUrl, bad).toBeNull();
    }
  });

  it('нет логина — подпись-фолбэк, профиль всё равно работает', () => {
    const stats = profileStats(row({ login: null }));
    expect(stats?.login).toBeNull();
    expect(stats?.caption).toBe('@чатерс');
    expect(stats?.initials).toBe('?');
    expect(stats?.balance).toBe(4320);
  });

  it('инициалы — первые буквы слов логина, camelCase считается словами', () => {
    expect(profileStats(row({ login: 'avrora_666' }))?.initials).toBe('A6');
    expect(profileStats(row({ login: 'Bradhi' }))?.initials).toBe('BR');
  });

  it('пустая строка / битые числа / нет времени — статов нет', () => {
    expect(profileStats(null)).toBeNull();
    expect(profileStats(row({ user_id: 'abc' }))).toBeNull();
    expect(profileStats(row({ balance: 'nope' }))).toBeNull();
    expect(profileStats(row({ balance: -1 }))).toBeNull();
    expect(profileStats(row({ capital: null }))).toBeNull();
    expect(profileStats(row({ lots_count: -1 }))).toBeNull();
    expect(profileStats(row({ created_at: 'не дата' }))).toBeNull();
  });

  it('нулевой капитал и ноль приветов — валидные статы', () => {
    const stats = profileStats(row({ capital: 0, lots_count: 0 }));
    expect(stats?.capital).toBe(0);
    expect(stats?.lotsCount).toBe(0);
  });
});

describe('formatProfileDate', () => {
  it('дата регистрации по-русски без «г.»', () => {
    expect(formatProfileDate('2026-09-12T10:00:00Z')).toBe('12 сентября 2026');
    expect(formatProfileDate('2026-01-01T10:00:00Z')).toBe('1 января 2026');
  });

  it('битая дата — пусто, а не «Invalid Date»', () => {
    expect(formatProfileDate('не дата')).toBe('');
    expect(formatProfileDate('')).toBe('');
  });
});

describe('formatProfileNumber', () => {
  it('числа — ru-RU с неразрывным разделителем разрядов', () => {
    expect(formatProfileNumber(4320)).toBe('4\u00A0320');
    expect(formatProfileNumber(1234567)).toBe('1\u00A0234\u00A0567');
    expect(formatProfileNumber(0)).toBe('0');
  });

  it('не число — прочерк', () => {
    expect(formatProfileNumber(Number.NaN)).toBe('—');
    expect(formatProfileNumber(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
