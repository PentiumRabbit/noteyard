import { DatabaseView } from "./DatabaseView";
import { ErrorBoundary } from "../ErrorBoundary";

interface Props {
  databaseId: string;
}

/**
 * ISS-028 / ISS-029: Error Boundary wrapper for DatabaseView.
 * Now delegates to the shared ErrorBoundary component.
 */
export function DatabaseViewErrorBoundary({ databaseId }: Props) {
  return (
    <ErrorBoundary fallbackTitle="数据库视图加载失败">
      <DatabaseView databaseId={databaseId} />
    </ErrorBoundary>
  );
}
