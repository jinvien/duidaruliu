/** 宿主从页面里采集到的原始数据。只含可序列化字段。 */
export type PageSnapshot = {
  url: string;
  title: string;
  lang: string;
  /** meta[name=description] */
  description: string;
  /** meta[property=og:description] */
  ogDescription: string;
  /** 用户在页面里选中的文字，没有则为空串。 */
  selection: string;
  /** document.documentElement.outerHTML */
  html: string;
};

/** 提取后的页面引用，会随消息一起保存到历史。 */
export type PageRef = {
  url: string;
  title: string;
  description: string;
  /** 阅读模式风格的 Markdown 正文。 */
  content: string;
  truncated: boolean;
  siteName?: string;
};

export type PageCaptureErrorCode = 'unsupported' | 'failed';

/** 宿主采不到页面时抛出，界面按 code 给提示。 */
export class PageCaptureError extends Error {
  code: PageCaptureErrorCode;

  constructor(code: PageCaptureErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PageCaptureError';
    this.code = code;
  }
}
