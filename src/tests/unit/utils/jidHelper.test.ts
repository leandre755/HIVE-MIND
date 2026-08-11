import { describe, it, expect } from '@jest/globals';
import {
  extractNumericId,
  normalizeJid,
  jidMatch,
  findInJidMap,
  findInJidArray,
  jidInList,
  getJidType,
  formatForDisplay,
} from '../../../utils/jidHelper.js';

describe('jidHelper', () => {
  describe('extractNumericId', () => {
    it('should extract numeric ID from standard phone JID', () => {
      expect(extractNumericId('2250102030405@s.whatsapp.net')).toBe('2250102030405');
    });

    it('should extract numeric ID from LID', () => {
      expect(extractNumericId('90366833332436@lid')).toBe('90366833332436');
    });

    it('should extract numeric ID when device prefix is present', () => {
      expect(extractNumericId('2250102030405:12@s.whatsapp.net')).toBe('2250102030405');
    });

    it('should return empty string for null or empty JID', () => {
      expect(extractNumericId(null)).toBe('');
      expect(extractNumericId('')).toBe('');
    });
  });

  describe('normalizeJid', () => {
    it('should format numeric ID to s.whatsapp.net', () => {
      expect(normalizeJid('2250102030405@lid')).toBe('2250102030405@s.whatsapp.net');
    });

    it('should return empty string for invalid inputs', () => {
      expect(normalizeJid(null)).toBe('');
    });
  });

  describe('jidMatch', () => {
    it('should return true for identical JIDs', () => {
      expect(jidMatch('2250102030405@s.whatsapp.net', '2250102030405@s.whatsapp.net')).toBe(true);
    });

    it('should return true when numeric IDs match across formats', () => {
      expect(jidMatch('2250102030405@s.whatsapp.net', '2250102030405@lid')).toBe(true);
    });

    it('should return false when JIDs do not match', () => {
      expect(jidMatch('1111111111111@s.whatsapp.net', '9999999999999@s.whatsapp.net')).toBe(false);
    });

    it('should handle null arguments gracefully', () => {
      expect(jidMatch(null, '2250102030405@s.whatsapp.net')).toBe(false);
    });
  });

  describe('findInJidMap & findInJidArray & jidInList', () => {
    it('should find entry in Map by JID', () => {
      const map = new Map<string, string>([['2250102030405@s.whatsapp.net', 'Owner']]);
      const match = findInJidMap('2250102030405@lid', map);
      expect(match).not.toBeNull();
      expect(match?.value).toBe('Owner');
    });

    it('should find entry in array', () => {
      const arr = [{ jid: '2250102030405@s.whatsapp.net', name: 'Mathieu' }];
      const found = findInJidArray('2250102030405@s.whatsapp.net', arr);
      expect(found?.name).toBe('Mathieu');
    });

    it('should check if JID is in list', () => {
      const set = new Set(['2250102030405@s.whatsapp.net']);
      expect(jidInList('2250102030405@lid', set)).toBe(true);
    });
  });

  describe('getJidType', () => {
    it('should identify phone, group, and lid JID types correctly', () => {
      expect(getJidType('12345@s.whatsapp.net')).toBe('phone');
      expect(getJidType('12345@g.us')).toBe('group');
      expect(getJidType('12345@lid')).toBe('lid');
      expect(getJidType('invalid')).toBe('unknown');
    });
  });

  describe('formatForDisplay', () => {
    it('should return name when provided and valid', () => {
      expect(formatForDisplay('2250102030405@s.whatsapp.net', 'Mathieu')).toBe('Mathieu');
    });

    it('should format masked number when name is missing or Inconnu', () => {
      expect(formatForDisplay('2250102030405@s.whatsapp.net', 'Inconnu')).toBe('+225***405');
    });

    it('should return Inconnu for empty JID and no name', () => {
      expect(formatForDisplay(null)).toBe('Inconnu');
    });
  });
});
