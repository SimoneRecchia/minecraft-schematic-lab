import type { ReactNode } from 'react';

export function Layout({
  left,
  center,
  right,
}: {
  left: ReactNode;
  center: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">minecraft-schematic-lab</h1>
        <span className="app-tag">driven by Claude · local preview</span>
      </header>
      <div className={right ? 'app-body' : 'app-body no-right'}>
        <aside className="app-col app-col-left">{left}</aside>
        <main className="app-col app-col-center">{center}</main>
        {right ? <aside className="app-col app-col-right">{right}</aside> : null}
      </div>
    </div>
  );
}
