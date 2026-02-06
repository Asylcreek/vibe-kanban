import { Outlet } from 'react-router-dom';
import '@/styles/new/index.css';

export function NewUiShowcaseLayout() {
  return (
    <div className="new-design ui-showcase-root">
      <Outlet />
    </div>
  );
}
