import type { Dispatch, SetStateAction } from 'react';

export type AppMode = 'chat' | 'setting' | string;
export type SetAppMode = Dispatch<SetStateAction<AppMode>>;

export const SHELL_MODE_EVENT = 'ddrl-shell';

export function appModeFromLocation(search = window.location.search): AppMode {
  return (new URLSearchParams(search).get('appMode') as AppMode) || 'chat';
}
