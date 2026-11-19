// Messages (vi/en), translator and formatters — framework-agnostic, shared by web + admin.
// React glue (providers, hooks) lives in each app. See packages/i18n/CLAUDE.md.
export * from './locale';
export * from './translator';
export * from './format';
export { en, type Messages } from './messages/en';
export { vi } from './messages/vi';
export { errorsEn, errorsVi, type ErrorMessages } from './messages/errors';
