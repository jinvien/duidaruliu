import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { getChatHost } from '../host';
import { extractPage, parseSnapshotHtml } from '../page/extract';
import { PageCaptureError } from '../page/types';

import type { PageCaptureErrorCode, PageRef } from '../page/types';
import type { AppDispatch } from './index';

export type PageState = {
  status: 'idle' | 'loading' | 'error';
  /** 同一时间只保留一个页面引用，新的直接替换旧的。 */
  ref: PageRef | null;
  error: PageCaptureErrorCode | null;
};

const initialState: PageState = { status: 'idle', ref: null, error: null };

const pageSlice = createSlice({
  name: 'page',
  initialState,
  reducers: {
    pageLoading: (state) => {
      state.status = 'loading';
      state.error = null;
    },
    pageLoaded: (state, action: PayloadAction<PageRef>) => {
      state.status = 'idle';
      state.ref = action.payload;
      state.error = null;
    },
    pageFailed: (state, action: PayloadAction<PageCaptureErrorCode>) => {
      state.status = 'error';
      state.error = action.payload;
    },
    clearPage: () => initialState,
  },
});

export const { pageLoading, pageLoaded, pageFailed, clearPage } = pageSlice.actions;

/** 连续触发时只认最后一次，旧请求回来也不覆盖。 */
let latestRequest = 0;

export async function loadPageRef(dispatch: AppDispatch, tabId?: number): Promise<void> {
  const capture = getChatHost().capturePage;
  if (!capture) return;
  const request = ++latestRequest;
  dispatch(pageLoading());
  try {
    const snapshot = await capture(tabId);
    const ref = await extractPage(parseSnapshotHtml(snapshot), snapshot);
    if (request === latestRequest) dispatch(pageLoaded(ref));
  } catch (error) {
    if (request !== latestRequest) return;
    dispatch(pageFailed(error instanceof PageCaptureError ? error.code : 'failed'));
  }
}

/** 发送或移除引用时调用，顺带让还在路上的采集作废。 */
export function discardPage(dispatch: AppDispatch) {
  latestRequest += 1;
  dispatch(clearPage());
}

export default pageSlice;
