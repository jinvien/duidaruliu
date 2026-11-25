/// <reference types="vite/client" />

declare module '*.less' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
