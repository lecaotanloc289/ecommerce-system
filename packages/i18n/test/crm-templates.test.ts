import { assertCrmTemplate } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { APP_LOCALES } from '../src/locale';
import { messages } from '../src/translator';

const DEFAULT_TEMPLATE_KEYS = ['thankYou', 'reviewRequest', 'reorderReminder'] as const;

describe('CRM default templates', () => {
  it.each(APP_LOCALES)('%s default templates pass assertCrmTemplate (no links)', (locale) => {
    for (const key of DEFAULT_TEMPLATE_KEYS) {
      expect(() => assertCrmTemplate(messages[locale].crm.defaultTemplates[key])).not.toThrow();
    }
  });

  it.each(APP_LOCALES)('%s default templates never use {couponCode}', (locale) => {
    for (const key of DEFAULT_TEMPLATE_KEYS) {
      expect(messages[locale].crm.defaultTemplates[key]).not.toContain('{couponCode}');
    }
  });
});
