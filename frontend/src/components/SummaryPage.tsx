import { Navigate } from 'react-router-dom';

export function SummaryPage(): JSX.Element {
  // 摘要页已下线：保留同名组件仅用于兼容旧入口，并统一跳转到看板主入口。
  return <Navigate to="/kanban" replace />;
}
