import { Component, type ReactNode } from "react";
import { DatabaseView } from "./DatabaseView";

interface Props {
  databaseId: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * ISS-028: Error Boundary wrapper for DatabaseView.
 * Catches render-time JS exceptions and shows a degraded error UI
 * instead of propagating to the root and causing a full page white screen.
 */
export class DatabaseViewErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error("[DatabaseViewErrorBoundary] caught error:", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "24px",
          border: "1px solid #f5c2c7",
          borderRadius: "8px",
          background: "#fff5f5",
          color: "#842029",
          margin: "8px 0",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>数据库视图加载失败</div>
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
    return <DatabaseView databaseId={this.props.databaseId} />;
  }
}
