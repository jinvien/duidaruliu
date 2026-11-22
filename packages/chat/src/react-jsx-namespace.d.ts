// React 19 去掉了全局 JSX 命名空间。tdesign-icons-react 0.4.3 的声明仍写 JSX.Element。
export {};

declare global {
  namespace JSX {
    type Element = React.JSX.Element;
  }
}
