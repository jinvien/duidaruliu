import i18n from '@/i18n';

export const PROMPTS = {
  TRANSLATE: {
    PROMPT_NAME: `<TRANSLATOR>`,
    PROMPT_PREFIX: i18n.t('prompt.aiTranslateSelected.promptPrefix'),
    PROMPT_POSTFIX: i18n.t('prompt.aiTranslateSelected.promptPostfix'),
    TEMPERATURE: 0.1,
  },
};
