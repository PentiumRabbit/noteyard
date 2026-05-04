import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 错误提示标题，默认为"组件加载失败" */
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * ISS-029: 通用 Error Boundary。
 * 捕获子树内的渲染时 JS 异常，降级展示区域错误提示（含"重新加载"按钮），
 * 不向根传播、不引发全页白屏。
 *
 * 用法：
 *   <ErrorBoundary fallbackTitle="编辑器加载失败">
 *     <Editor ... />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const title = this.props.fallbackTitle ?? "组件加载失败";
    console.error(`[ErrorBoundary][${title}] caught error:`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle ?? "组件加载失败";
      return (
        <div style={{
          padding: "24px",
          border: "1px solid #f5c2c7",
          borderRadius: "8px",
          background: "#fff5f5",
          color: "#842029",
          margin: "8px 0",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 13, marginBottom: 12, color: "#6c1d1d" }}>
            {this.state.errorMessage || "发生未知错误"}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #f5c2c7",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
